// Global cache data
let cacheData = {};
let processedData = {};

// Load cache data
async function loadCacheData() {
    try {
        const response = await fetch('cache_data.json');
        if (!response.ok) {
            throw new Error('Failed to load cache data');
        }
        cacheData = await response.json();
        console.log('Cache data loaded:', cacheData);
        
        processCacheData();
        updateCacheInfo();
        updateDashboard();
    } catch (error) {
        console.error('Error loading cache:', error);
        document.getElementById('cacheInfo').innerHTML = 
            '<div class="error">Ошибка загрузки кеша. Убедитесь, что файл cache_data.json существует.</div>';
    }
}

// Process cache data for visualization
function processCacheData() {
    processedData = {
        byDate: {},
        byNetwork: {},
        byMarket: {},
        totals: {
            softLiquidations: 0,
            hardLiquidations: 0,
            totalVolume: 0,
            uniqueMarkets: new Set()
        }
    };
    
    // Process each market in cache
    Object.keys(cacheData).forEach(key => {
        const parts = key.split('_');
        const network = parts[0];
        const market = parts[parts.length - 1];
        
        const marketData = cacheData[key];
        if (!marketData.results) return;
        
        marketData.results.forEach(snapshot => {
            // Get date from block timestamp if available
            const blockNumber = snapshot.block_number;
            const date = estimateDate(network, blockNumber);
            const dateStr = date.toISOString().split('T')[0];
            
            // Initialize date entry
            if (!processedData.byDate[dateStr]) {
                processedData.byDate[dateStr] = {
                    soft: 0,
                    hard: 0,
                    volume: 0,
                    positions: []
                };
            }
            
            // Initialize network entry
            if (!processedData.byNetwork[network]) {
                processedData.byNetwork[network] = {
                    soft: 0,
                    hard: 0,
                    volume: 0,
                    dateRange: { min: null, max: null }
                };
            }
            
            // Initialize market entry
            if (!processedData.byMarket[market]) {
                processedData.byMarket[market] = {
                    soft: 0,
                    hard: 0,
                    volume: 0,
                    network: network
                };
            }
            
            // Count liquidations
            const softCount = snapshot.soft_liq_count || 0;
            const totalPositions = snapshot.total_positions || 0;
            const hardCount = totalPositions - softCount - (snapshot.ignored_positions || 0);
            const volume = snapshot.total_collateral_usd || 0;
            
            // Update aggregates
            processedData.byDate[dateStr].soft += softCount;
            processedData.byDate[dateStr].hard += hardCount;
            processedData.byDate[dateStr].volume += volume;
            
            processedData.byNetwork[network].soft += softCount;
            processedData.byNetwork[network].hard += hardCount;
            processedData.byNetwork[network].volume += volume;
            
            processedData.byMarket[market].soft += softCount;
            processedData.byMarket[market].hard += hardCount;
            processedData.byMarket[market].volume += volume;
            
            processedData.totals.softLiquidations += softCount;
            processedData.totals.hardLiquidations += hardCount;
            processedData.totals.totalVolume += volume;
            processedData.totals.uniqueMarkets.add(market);
            
            // Update date range for network
            if (!processedData.byNetwork[network].dateRange.min || date < processedData.byNetwork[network].dateRange.min) {
                processedData.byNetwork[network].dateRange.min = date;
            }
            if (!processedData.byNetwork[network].dateRange.max || date > processedData.byNetwork[network].dateRange.max) {
                processedData.byNetwork[network].dateRange.max = date;
            }
        });
    });
}

// Estimate date from block number (approximate)
function estimateDate(network, blockNumber) {
    const blockTimes = {
        ethereum: 12, // seconds per block
        arbitrum: 0.25, // seconds per block
        fraxtal: 2 // seconds per block
    };
    
    const referenceBlocks = {
        ethereum: { block: 21515000, date: new Date('2025-01-01') },
        arbitrum: { block: 290658752, date: new Date('2025-01-01') },
        fraxtal: { block: 19840000, date: new Date('2025-01-01') }
    };
    
    const ref = referenceBlocks[network];
    const blockTime = blockTimes[network];
    
    if (!ref) return new Date();
    
    const blockDiff = blockNumber - ref.block;
    const secondsDiff = blockDiff * blockTime;
    const estimatedDate = new Date(ref.date.getTime() + secondsDiff * 1000);
    
    return estimatedDate;
}

// Update cache information display
function updateCacheInfo() {
    const cacheInfoDiv = document.getElementById('cacheInfo');
    let html = '<div style="font-weight: bold; margin-bottom: 10px;">Доступные периоды:</div>';
    
    const networkRanges = {};
    
    Object.keys(cacheData).forEach(key => {
        const parts = key.split('_');
        const network = parts[0];
        const marketData = cacheData[key];
        
        if (!networkRanges[network]) {
            networkRanges[network] = {
                min: null,
                max: null,
                markets: new Set()
            };
        }
        
        if (marketData.range) {
            const minBlock = marketData.range.from_block;
            const maxBlock = marketData.range.to_block;
            const minDate = estimateDate(network, minBlock);
            const maxDate = estimateDate(network, maxBlock);
            
            if (!networkRanges[network].min || minDate < networkRanges[network].min) {
                networkRanges[network].min = minDate;
            }
            if (!networkRanges[network].max || maxDate > networkRanges[network].max) {
                networkRanges[network].max = maxDate;
            }
            
            networkRanges[network].markets.add(parts[parts.length - 1]);
        }
    });
    
    Object.keys(networkRanges).forEach(network => {
        const range = networkRanges[network];
        if (range.min && range.max) {
            html += `
                <div class="cache-range">
                    <span class="network-badge network-${network}">${network}</span>
                    <span>${range.min.toLocaleDateString()} - ${range.max.toLocaleDateString()}</span>
                    <span>${range.markets.size} маркетов</span>
                </div>
            `;
        }
    });
    
    if (Object.keys(networkRanges).length === 0) {
        html = '<div>Нет данных в кеше</div>';
    }
    
    cacheInfoDiv.innerHTML = html;
}

// Update dashboard with filtered data
function updateDashboard() {
    const network = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    // Filter data
    let filteredData = {
        byDate: {},
        soft: 0,
        hard: 0,
        volume: 0,
        markets: new Set()
    };
    
    Object.keys(processedData.byDate).forEach(dateStr => {
        const date = new Date(dateStr);
        if (date >= dateFrom && date <= dateTo) {
            if (network === 'all') {
                filteredData.byDate[dateStr] = processedData.byDate[dateStr];
                filteredData.soft += processedData.byDate[dateStr].soft;
                filteredData.hard += processedData.byDate[dateStr].hard;
                filteredData.volume += processedData.byDate[dateStr].volume;
            } else {
                // Filter by network (approximate)
                // This would need more detailed data structure for accurate filtering
                filteredData.byDate[dateStr] = processedData.byDate[dateStr];
                filteredData.soft += processedData.byDate[dateStr].soft;
                filteredData.hard += processedData.byDate[dateStr].hard;
                filteredData.volume += processedData.byDate[dateStr].volume;
            }
        }
    });
    
    // Update statistics
    updateStats(filteredData);
    
    // Update charts
    updateMainChart(filteredData);
    updateComparisonChart(filteredData);
    updateNetworkChart();
    updateTopMarkets();
}

// Update statistics cards
function updateStats(data) {
    // Считаем реальный объем из последних снапшотов (как в отчете)
    let realTotalVolume = 0;
    let uniquePositions = new Set();
    let totalSoftCount = 0;
    let totalHardCount = 0;
    
    // Проходим по всем маркетам и берем последний снапшот
    Object.keys(cacheData).forEach(key => {
        const marketData = cacheData[key];
        if (!marketData.results || marketData.results.length === 0) return;
        
        // Берем последний снапшот
        const lastSnapshot = marketData.results.reduce((latest, current) => {
            const latestBlock = latest.block_number || 0;
            const currentBlock = current.block_number || 0;
            return currentBlock > latestBlock ? current : latest;
        });
        
        // Считаем из position_details (уникальные позиции)
        if (lastSnapshot.position_details) {
            Object.entries(lastSnapshot.position_details).forEach(([posKey, pos]) => {
                uniquePositions.add(posKey);
                realTotalVolume += pos.total_usd || 0;
            });
        }
        
        totalSoftCount += lastSnapshot.soft_liq_count || 0;
        const totalPos = lastSnapshot.total_positions || 0;
        const ignoredPos = lastSnapshot.ignored_positions || 0;
        totalHardCount += Math.max(0, totalPos - totalSoftCount - ignoredPos);
    });
    
    const statsGrid = document.getElementById('statsGrid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${uniquePositions.size.toLocaleString()}</div>
            <div class="stat-label">Уникальных позиций</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${totalSoftCount.toLocaleString()}</div>
            <div class="stat-label">Софт-ликвидаций</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">$${(realTotalVolume / 1000000).toFixed(2)}M</div>
            <div class="stat-label">Реальный объем (USD)</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${processedData.totals.uniqueMarkets.size}</div>
            <div class="stat-label">Активных маркетов</div>
        </div>
    `;
}

// Update main chart
function updateMainChart(data) {
    const dates = Object.keys(data.byDate).sort();
    const softValues = dates.map(d => data.byDate[d].soft);
    const hardValues = dates.map(d => data.byDate[d].hard);
    const volumeValues = dates.map(d => data.byDate[d].volume);
    
    const trace1 = {
        x: dates,
        y: softValues,
        name: 'Софт-ликвидации',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#667eea', width: 2 },
        marker: { size: 6 }
    };
    
    const trace2 = {
        x: dates,
        y: hardValues,
        name: 'Хард-ликвидации',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#ff4444', width: 2 },
        marker: { size: 6 }
    };
    
    const trace3 = {
        x: dates,
        y: volumeValues,
        name: 'Объем (USD)',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#44bb44', width: 1, dash: 'dot' },
        yaxis: 'y2',
        opacity: 0.5
    };
    
    const layout = {
        title: '',
        xaxis: {
            title: 'Дата',
            gridcolor: '#e0e0e0'
        },
        yaxis: {
            title: 'Количество ликвидаций',
            gridcolor: '#e0e0e0'
        },
        yaxis2: {
            title: 'Объем (USD)',
            overlaying: 'y',
            side: 'right'
        },
        hovermode: 'x unified',
        legend: {
            x: 0,
            y: 1,
            orientation: 'h'
        },
        margin: { t: 30 }
    };
    
    Plotly.newPlot('mainChart', [trace1, trace2, trace3], layout, {responsive: true});
}

// Update comparison chart
function updateComparisonChart(data) {
    const dates = Object.keys(data.byDate).sort();
    const softValues = dates.map(d => data.byDate[d].soft);
    const hardValues = dates.map(d => data.byDate[d].hard);
    
    const trace1 = {
        x: dates,
        y: softValues,
        name: 'Софт-ликвидации',
        type: 'bar',
        marker: { color: '#667eea' }
    };
    
    const trace2 = {
        x: dates,
        y: hardValues,
        name: 'Хард-ликвидации',
        type: 'bar',
        marker: { color: '#ff4444' }
    };
    
    const layout = {
        barmode: 'stack',
        xaxis: {
            title: 'Дата',
            gridcolor: '#e0e0e0'
        },
        yaxis: {
            title: 'Количество',
            gridcolor: '#e0e0e0'
        },
        hovermode: 'x unified',
        legend: {
            x: 0,
            y: 1,
            orientation: 'h'
        },
        margin: { t: 30 }
    };
    
    Plotly.newPlot('comparisonChart', [trace1, trace2], layout, {responsive: true});
}

// Update network distribution chart
function updateNetworkChart() {
    const networks = Object.keys(processedData.byNetwork);
    const values = networks.map(n => processedData.byNetwork[n].volume);
    
    const data = [{
        values: values,
        labels: networks,
        type: 'pie',
        marker: {
            colors: ['#627EEA', '#28A0F0', '#FF6B6B']
        }
    }];
    
    const layout = {
        margin: { t: 0, b: 0 }
    };
    
    Plotly.newPlot('networkChart', data, layout, {responsive: true});
}

// Update top markets chart
function updateTopMarkets() {
    // Используем последний снапшот для каждого маркета (как в отчете)
    const marketLastVolumes = {};
    
    // Проходим по всем маркетам и берем последний снапшот
    Object.keys(cacheData).forEach(key => {
        const parts = key.split('_');
        const market = parts[parts.length - 1];
        const network = parts[0];
        const marketData = cacheData[key];
        
        if (!marketData.results || marketData.results.length === 0) return;
        
        // Берем последний снапшот (с максимальным block_number)
        const lastSnapshot = marketData.results.reduce((latest, current) => {
            const latestBlock = latest.block_number || 0;
            const currentBlock = current.block_number || 0;
            return currentBlock > latestBlock ? current : latest;
        });
        
        // Суммируем объем из position_details (как в отчете)
        let marketVolume = 0;
        if (lastSnapshot.position_details) {
            Object.values(lastSnapshot.position_details).forEach(pos => {
                marketVolume += pos.total_usd || 0;
            });
        } else {
            // Fallback на total_collateral_usd если нет position_details
            marketVolume = lastSnapshot.total_collateral_usd || 0;
        }
        
        if (!marketLastVolumes[market]) {
            marketLastVolumes[market] = 0;
        }
        marketLastVolumes[market] += marketVolume;
    });
    
    // Сортируем и берем топ-10
    const sortedMarkets = Object.entries(marketLastVolumes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    const markets = sortedMarkets.map(m => m[0]);
    const values = sortedMarkets.map(m => m[1]);
    
    const data = [{
        x: values,
        y: markets,
        type: 'bar',
        orientation: 'h',
        marker: {
            color: '#667eea'
        },
        text: values.map(v => '$' + (v / 1000000).toFixed(2) + 'M'),
        textposition: 'outside'
    }];
    
    const layout = {
        margin: { t: 0, l: 100, r: 80 },
        xaxis: {
            title: 'Объем последнего снапшота (USD)',
            gridcolor: '#e0e0e0',
            tickformat: ',.0f'
        }
    };
    
    Plotly.newPlot('topMarkets', data, layout, {responsive: true});
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Set default dates
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    document.getElementById('dateFrom').value = monthAgo.toISOString().split('T')[0];
    document.getElementById('dateTo').value = today.toISOString().split('T')[0];
    
    // Load cache data
    loadCacheData();
});