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
            '<div class="error">Cache loading error. Make sure cache_data.json file exists.</div>';
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
        },
        hardLiquidationsList: []  // List of actual hard liquidations
    };
    
    // First process hard liquidations from database
    if (cacheData.hard_liquidations) {
        processedData.hardLiquidationsList = cacheData.hard_liquidations;
        
        // Aggregate hard liquidations by dates
        cacheData.hard_liquidations.forEach(liq => {
            const date = new Date(liq.date);
            const dateStr = date.toISOString().split('T')[0];
            
            if (!processedData.byDate[dateStr]) {
                processedData.byDate[dateStr] = {
                    soft: 0,
                    hard: 0,
                    volume: 0,
                    positions: []
                };
            }
            
            processedData.byDate[dateStr].hard += 1;
            processedData.byDate[dateStr].volume += liq.debt_repaid || 0;
            
            // By networks
            const network = liq.network;
            if (!processedData.byNetwork[network]) {
                processedData.byNetwork[network] = {
                    soft: 0,
                    hard: 0,
                    volume: 0,
                    dateRange: { min: null, max: null }
                };
            }
            processedData.byNetwork[network].hard += 1;
            
            // By markets
            const market = liq.market;
            if (!processedData.byMarket[market]) {
                processedData.byMarket[market] = {
                    soft: 0,
                    hard: 0,
                    volume: 0,
                    network: network
                };
            }
            processedData.byMarket[market].hard += 1;
            
            processedData.totals.hardLiquidations += 1;
        });
    }
    
    // First, collect the last snapshot per day for each market
    const marketDailySnapshots = {};
    
    Object.keys(cacheData).forEach(key => {
        if (key === 'hard_liquidations') return; // Skip special field
        
        const parts = key.split('_');
        const network = parts[0];
        const market = parts[parts.length - 1];
        
        const marketData = cacheData[key];
        if (!marketData.results) return;
        
        // Group snapshots by date and keep only the last one for each date
        const dailySnapshots = {};
        
        marketData.results.forEach(snapshot => {
            const blockNumber = snapshot.block_number;
            const date = estimateDate(network, blockNumber);
            const dateStr = date.toISOString().split('T')[0];
            
            // Keep only the latest snapshot for each date
            if (!dailySnapshots[dateStr] || snapshot.block_number > dailySnapshots[dateStr].block_number) {
                dailySnapshots[dateStr] = {
                    snapshot: snapshot,
                    network: network,
                    market: market,
                    date: date,
                    block_number: snapshot.block_number
                };
            }
        });
        
        marketDailySnapshots[key] = dailySnapshots;
    });
    
    // Now process the last snapshots for each day
    Object.keys(marketDailySnapshots).forEach(marketKey => {
        const dailySnapshots = marketDailySnapshots[marketKey];
        
        Object.keys(dailySnapshots).forEach(dateStr => {
            const data = dailySnapshots[dateStr];
            const snapshot = data.snapshot;
            const network = data.network;
            const market = data.market;
            const date = data.date;
            
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
            
            // Count liquidations from last snapshot only
            const softCount = snapshot.soft_liq_count || 0;
            const volume = snapshot.total_collateral_usd || 0;
            
            // Update aggregates (now using only last snapshot per day)
            processedData.byDate[dateStr].soft += softCount;
            processedData.byDate[dateStr].volume += volume;
            
            processedData.byNetwork[network].soft += softCount;
            processedData.byNetwork[network].volume += volume;
            
            processedData.byMarket[market].soft += softCount;
            processedData.byMarket[market].volume += volume;
            
            processedData.totals.softLiquidations += softCount;
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
    let html = '<div style="font-weight: bold; margin-bottom: 15px; margin-top: 10px;">Available date ranges:</div>';
    
    const networkRanges = {};
    
    Object.keys(cacheData).forEach(key => {
        if (key === 'hard_liquidations') return; // Skip hard liquidations
        
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
                    <span>${range.min.toLocaleDateString('en-US')} - ${range.max.toLocaleDateString('en-US')}</span>
                    <span>${range.markets.size} markets</span>
                </div>
            `;
        }
    });
    
    if (Object.keys(networkRanges).length === 0) {
        html = '<div>No data in cache</div>';
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
    updateNetworkCharts();
    updateTopMarkets();
    updateFundsSavedTotal();
    updateFundsSavedChart();
    updateTopTokensChart();
}

// Update statistics cards
function updateStats(data) {
    // Get selected period and network
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    let maxTotalVolume = 0;
    let uniquePositions = new Set();
    let maxSoftCount = 0;
    let activeMarkets = new Set();
    
    // For each market find maximum volume for period
    Object.keys(cacheData).forEach(key => {
        const parts = key.split('_');
        const market = parts[parts.length - 1];
        const network = parts[0];
        const marketData = cacheData[key];
        
        // Filter by network
        if (networkFilter !== 'all' && network !== networkFilter) return;
        
        if (!marketData.results || marketData.results.length === 0) return;
        
        let maxMarketVolume = 0;
        let maxMarketSoftCount = 0;
        let marketHasData = false;
        
        // Go through snapshots and find maximum values for period
        marketData.results.forEach(snapshot => {
            const blockNumber = snapshot.block_number;
            const snapshotDate = estimateDate(network, blockNumber);
            
            if (snapshotDate >= dateFrom && snapshotDate <= dateTo) {
                marketHasData = true;
                
                // Calculate volume
                let snapshotVolume = 0;
                if (snapshot.position_details) {
                    Object.entries(snapshot.position_details).forEach(([posKey, pos]) => {
                        uniquePositions.add(posKey);
                        snapshotVolume += pos.total_usd || 0;
                    });
                } else {
                    snapshotVolume = snapshot.total_collateral_usd || 0;
                }
                
                // Take maximum values
                maxMarketVolume = Math.max(maxMarketVolume, snapshotVolume);
                maxMarketSoftCount = Math.max(maxMarketSoftCount, snapshot.soft_liq_count || 0);
            }
        });
        
        if (marketHasData) {
            activeMarkets.add(market);
            maxTotalVolume += maxMarketVolume;
            maxSoftCount += maxMarketSoftCount;
        }
    });
    
    // Count hard liquidations for period
    let hardLiqCount = 0;
    if (processedData.hardLiquidationsList) {
        processedData.hardLiquidationsList.forEach(liq => {
            const liqDate = new Date(liq.date);
            if (liqDate >= dateFrom && liqDate <= dateTo) {
                if (networkFilter === 'all' || liq.network === networkFilter) {
                    hardLiqCount++;
                }
            }
        });
    }
    
    const statsGrid = document.getElementById('statsGrid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${maxSoftCount.toLocaleString()}</div>
            <div class="stat-label">Liquidation Protection Mode</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${hardLiqCount.toLocaleString()}</div>
            <div class="stat-label">Hard Liquidations</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">$${(maxTotalVolume / 1000000).toFixed(2)}M</div>
            <div class="stat-label">Max Volume for Period</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${activeMarkets.size}</div>
            <div class="stat-label">Active Markets</div>
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
        name: 'Liquidation Protection Mode',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#667eea', width: 2 },
        marker: { size: 6 }
    };
    
    const trace2 = {
        x: dates,
        y: hardValues,
        name: 'Hard Liquidations',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#ff4444', width: 2 },
        marker: { size: 6 }
    };
    
    const trace3 = {
        x: dates,
        y: volumeValues,
        name: 'Volume (USD)',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#44bb44', width: 1, dash: 'dot' },
        yaxis: 'y2',
        opacity: 0.5
    };
    
    const layout = {
        title: '',
        xaxis: {
            title: 'Date',
            gridcolor: '#e0e0e0'
        },
        yaxis: {
            title: 'Number of Liquidations',
            gridcolor: '#e0e0e0'
        },
        yaxis2: {
            title: 'Volume (USD)',
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
        name: 'Liquidation Protection Mode',
        type: 'bar',
        marker: { color: '#667eea' }
    };
    
    const trace2 = {
        x: dates,
        y: hardValues,
        name: 'Hard Liquidations',
        type: 'bar',
        marker: { color: '#ff4444' }
    };
    
    const layout = {
        barmode: 'stack',
        xaxis: {
            title: 'Date',
            gridcolor: '#e0e0e0'
        },
        yaxis: {
            title: 'Count',
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

// Update network distribution charts
function updateNetworkCharts() {
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    // Calculate soft and hard liquidation volumes by network for selected period
    const softVolumeByNetwork = {};
    const hardVolumeByNetwork = {};
    
    // Soft liquidations (volume in USD)
    Object.keys(cacheData).forEach(key => {
        if (key === 'hard_liquidations') return;
        
        const parts = key.split('_');
        const network = parts[0];
        const marketData = cacheData[key];
        
        if (networkFilter !== 'all' && network !== networkFilter) return;
        if (!marketData.results) return;
        
        if (!softVolumeByNetwork[network]) {
            softVolumeByNetwork[network] = 0;
        }
        
        marketData.results.forEach(snapshot => {
            const blockNumber = snapshot.block_number;
            const snapshotDate = estimateDate(network, blockNumber);
            
            if (snapshotDate >= dateFrom && snapshotDate <= dateTo) {
                // Add volume in USD, not count
                softVolumeByNetwork[network] += snapshot.total_collateral_usd || 0;
            }
        });
    });
    
    // Hard liquidations (volume in USD)
    if (processedData.hardLiquidationsList) {
        processedData.hardLiquidationsList.forEach(liq => {
            const liqDate = new Date(liq.date);
            if (liqDate >= dateFrom && liqDate <= dateTo) {
                if (networkFilter === 'all' || liq.network === networkFilter) {
                    if (!hardVolumeByNetwork[liq.network]) {
                        hardVolumeByNetwork[liq.network] = 0;
                    }
                    // Add debt repaid volume, not count
                    hardVolumeByNetwork[liq.network] += liq.debt_repaid || 0;
                }
            }
        });
    }
    
    // Soft liquidations chart
    const softNetworks = Object.keys(softVolumeByNetwork);
    const softValues = softNetworks.map(n => softVolumeByNetwork[n]);
    
    const softData = [{
        values: softValues,
        labels: softNetworks.map(n => n.charAt(0).toUpperCase() + n.slice(1)),
        type: 'pie',
        marker: {
            colors: ['#667eea', '#764ba2', '#f093fb']
        },
        textinfo: 'label+percent',
        text: softValues.map(v => `$${(v/1000000).toFixed(2)}M`),
        textposition: 'outside',
        hovertemplate: '%{label}: $%{value:,.0f}<br>%{percent}<extra></extra>'
    }];
    
    const softLayout = {
        margin: { t: 10, b: 10 },
        showlegend: false
    };
    
    Plotly.newPlot('networkChartSoft', softData, softLayout, {responsive: true});
    
    // Hard liquidations chart
    const hardNetworks = Object.keys(hardVolumeByNetwork);
    const hardValues = hardNetworks.map(n => hardVolumeByNetwork[n]);
    
    if (hardNetworks.length > 0 && hardValues.some(v => v > 0)) {
        const hardData = [{
            values: hardValues,
            labels: hardNetworks.map(n => n.charAt(0).toUpperCase() + n.slice(1)),
            type: 'pie',
            marker: {
                colors: ['#ff6b6b', '#ff8787', '#ffa3a3']
            },
            textinfo: 'label+percent',
            text: hardValues.map(v => `$${(v/1000000).toFixed(2)}M`),
            textposition: 'outside',
            hovertemplate: '%{label}: $%{value:,.0f}<br>%{percent}<extra></extra>'
        }];
        
        const hardLayout = {
            margin: { t: 10, b: 10 },
            showlegend: false
        };
        
        Plotly.newPlot('networkChartHard', hardData, hardLayout, {responsive: true});
    } else {
        // If no hard liquidations, show message
        document.getElementById('networkChartHard').innerHTML = 
            '<div style="text-align: center; padding: 50px; color: #999;">No hard liquidation data for selected period</div>';
    }
}

// Update top markets chart
function updateTopMarkets() {
    // Get selected period
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    // Calculate maximum volume for each market for selected period
    const marketVolumes = {};
    
    Object.keys(cacheData).forEach(key => {
        const parts = key.split('_');
        const market = parts[parts.length - 1];
        const network = parts[0];
        const marketData = cacheData[key];
        
        // Filter by network if selected
        if (networkFilter !== 'all' && network !== networkFilter) return;
        
        if (!marketData.results || marketData.results.length === 0) return;
        
        // Find maximum volume for period
        let maxVolumeInPeriod = 0;
        
        marketData.results.forEach(snapshot => {
            // Проверяем попадает ли снапшот в выбранный период
            const blockNumber = snapshot.block_number;
            const snapshotDate = estimateDate(network, blockNumber);
            
            if (snapshotDate >= dateFrom && snapshotDate <= dateTo) {
                // Calculate volume из position_details или total_collateral_usd
                let snapshotVolume = 0;
                
                if (snapshot.position_details) {
                    Object.values(snapshot.position_details).forEach(pos => {
                        snapshotVolume += pos.total_usd || 0;
                    });
                } else {
                    snapshotVolume = snapshot.total_collateral_usd || 0;
                }
                
                // Берем максимальный объем за период
                maxVolumeInPeriod = Math.max(maxVolumeInPeriod, snapshotVolume);
            }
        });
        
        // Суммируем максимальные объемы по маркетам (если есть несколько контроллеров для одного маркета)
        if (!marketVolumes[market]) {
            marketVolumes[market] = 0;
        }
        marketVolumes[market] += maxVolumeInPeriod;
    });
    
    // Сортируем и берем топ-10
    const sortedMarkets = Object.entries(marketVolumes)
        .filter(([_, volume]) => volume > 0) // Только маркеты с объемом
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
        textposition: 'outside',
        hovertemplate: '%{y}: $%{x:,.0f}<extra></extra>'
    }];
    
    const layout = {
        margin: { t: 0, l: 100, r: 80 },
        xaxis: {
            title: 'Maximum Volume for Period (USD)',
            gridcolor: '#e0e0e0',
            tickformat: ',.0f'
        },
        yaxis: {
            automargin: true
        }
    };
    
    Plotly.newPlot('topMarkets', data, layout, {responsive: true});
}

// Update Total Funds Saved
function updateFundsSavedTotal() {
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    let totalLiquidationProtection = 0;
    let totalFullLiquidations = 0;
    
    // Софт-ликвидации (защищенные средства) - use last snapshot per market in date range
    Object.keys(cacheData).forEach(key => {
        if (key === 'hard_liquidations') return;
        
        const parts = key.split('_');
        const network = parts[0];
        const marketData = cacheData[key];
        
        if (networkFilter !== 'all' && network !== networkFilter) return;
        if (!marketData.results || marketData.results.length === 0) return;
        
        // Find the last snapshot within date range for this market
        let lastValidSnapshot = null;
        
        marketData.results.forEach(snapshot => {
            const blockNumber = snapshot.block_number;
            const snapshotDate = estimateDate(network, blockNumber);
            
            if (snapshotDate >= dateFrom && snapshotDate <= dateTo) {
                if (!lastValidSnapshot || snapshot.block_number > lastValidSnapshot.block_number) {
                    lastValidSnapshot = snapshot;
                }
            }
        });
        
        // Add only the last snapshot's volume for this market
        if (lastValidSnapshot) {
            totalLiquidationProtection += lastValidSnapshot.total_collateral_usd || 0;
        }
    });
    
    // Хард-ликвидации
    if (processedData.hardLiquidationsList) {
        processedData.hardLiquidationsList.forEach(liq => {
            const liqDate = new Date(liq.date);
            if (liqDate >= dateFrom && liqDate <= dateTo) {
                if (networkFilter === 'all' || liq.network === networkFilter) {
                    totalFullLiquidations += liq.debt_repaid || 0;
                }
            }
        });
    }
    
    const totalFundsSaved = totalLiquidationProtection - totalFullLiquidations;
    
    const data = [{
        x: ['Liquidation Protection', 'Full Liquidations', 'Funds Saved'],
        y: [totalLiquidationProtection, totalFullLiquidations, totalFundsSaved],
        type: 'bar',
        marker: {
            color: ['#ffd700', '#ff6b6b', '#4ecdc4']
        },
        text: [
            `$${(totalLiquidationProtection / 1000000).toFixed(2)}M`,
            `$${(totalFullLiquidations / 1000000).toFixed(2)}M`,
            `$${(totalFundsSaved / 1000000).toFixed(2)}M`
        ],
        textposition: 'outside'
    }];
    
    const layout = {
        margin: { t: 30, b: 50 },
        yaxis: {
            title: 'Value (USD)',
            tickformat: ',.0f'
        },
        hovermode: 'x unified'
    };
    
    Plotly.newPlot('fundsSavedTotal', data, layout, {responsive: true});
}

// Update Funds Saved by Network
function updateFundsSavedByNetwork() {
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    const dataByNetwork = {};
    
    // Софт-ликвидации по сетям - use last snapshot per market
    Object.keys(cacheData).forEach(key => {
        if (key === 'hard_liquidations') return;
        
        const parts = key.split('_');
        const network = parts[0];
        const marketData = cacheData[key];
        
        if (networkFilter !== 'all' && network !== networkFilter) return;
        if (!marketData.results || marketData.results.length === 0) return;
        
        if (!dataByNetwork[network]) {
            dataByNetwork[network] = {
                liquidationProtection: 0,
                fullLiquidations: 0,
                fundsSaved: 0
            };
        }
        
        // Find the last snapshot within date range for this market
        let lastValidSnapshot = null;
        
        marketData.results.forEach(snapshot => {
            const blockNumber = snapshot.block_number;
            const snapshotDate = estimateDate(network, blockNumber);
            
            if (snapshotDate >= dateFrom && snapshotDate <= dateTo) {
                if (!lastValidSnapshot || snapshot.block_number > lastValidSnapshot.block_number) {
                    lastValidSnapshot = snapshot;
                }
            }
        });
        
        // Add only the last snapshot's volume for this market
        if (lastValidSnapshot) {
            dataByNetwork[network].liquidationProtection += lastValidSnapshot.total_collateral_usd || 0;
        }
    });
    
    // Хард-ликвидации по сетям
    if (processedData.hardLiquidationsList) {
        processedData.hardLiquidationsList.forEach(liq => {
            const liqDate = new Date(liq.date);
            if (liqDate >= dateFrom && liqDate <= dateTo) {
                if (networkFilter === 'all' || liq.network === networkFilter) {
                    const network = liq.network;
                    
                    if (!dataByNetwork[network]) {
                        dataByNetwork[network] = {
                            liquidationProtection: 0,
                            fullLiquidations: 0,
                            fundsSaved: 0
                        };
                    }
                    
                    dataByNetwork[network].fullLiquidations += liq.debt_repaid || 0;
                }
            }
        });
    }
    
    // Calculate funds saved
    Object.keys(dataByNetwork).forEach(network => {
        dataByNetwork[network].fundsSaved = 
            dataByNetwork[network].liquidationProtection - dataByNetwork[network].fullLiquidations;
    });
    
    const networks = Object.keys(dataByNetwork).sort();
    const networkLabels = networks.map(n => n.charAt(0).toUpperCase() + n.slice(1));
    
    const trace1 = {
        x: networkLabels,
        y: networks.map(n => dataByNetwork[n].liquidationProtection),
        name: 'Liquidation Protection',
        type: 'bar',
        marker: { color: '#ffd700' },
        text: networks.map(n => `$${(dataByNetwork[n].liquidationProtection / 1000000).toFixed(2)}M`),
        textposition: 'outside'
    };
    
    const trace2 = {
        x: networkLabels,
        y: networks.map(n => dataByNetwork[n].fullLiquidations),
        name: 'Full Liquidations',
        type: 'bar',
        marker: { color: '#ff6b6b' },
        text: networks.map(n => `$${(dataByNetwork[n].fullLiquidations / 1000000).toFixed(2)}M`),
        textposition: 'outside'
    };
    
    const trace3 = {
        x: networkLabels,
        y: networks.map(n => dataByNetwork[n].fundsSaved),
        name: 'Funds Saved',
        type: 'bar',
        marker: { color: '#4ecdc4' },
        text: networks.map(n => `$${(dataByNetwork[n].fundsSaved / 1000000).toFixed(2)}M`),
        textposition: 'outside'
    };
    
    const layout = {
        barmode: 'group',
        xaxis: { title: 'Network' },
        yaxis: { 
            title: 'Value (USD)',
            tickformat: ',.0f'
        },
        hovermode: 'x unified',
        legend: {
            x: 0,
            y: 1,
            orientation: 'h'
        }
    };
    
    Plotly.newPlot('fundsSavedByNetwork', [trace1, trace2, trace3], layout, {responsive: true});
}

// Update Funds Saved chart by Platform
function updateFundsSavedChart() {
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    // Calculate volumes by platforms
    const dataByPlatform = {
        'crvUSD': {
            liquidationProtection: 0,
            fullLiquidations: 0,
            fundsSaved: 0
        },
        'LlamaLend': {
            liquidationProtection: 0,
            fullLiquidations: 0,
            fundsSaved: 0
        }
    };
    
    // Софт-ликвидации (защищенные средства)
    Object.keys(cacheData).forEach(key => {
        if (key === 'hard_liquidations') return;
        
        const parts = key.split('_');
        const network = parts[0];
        const marketData = cacheData[key];
        
        if (networkFilter !== 'all' && network !== networkFilter) return;
        if (!marketData.results) return;
        
        // Determine platform by key
        const platform = key.toLowerCase().includes('crvusd') ? 'crvUSD' : 'LlamaLend';
        
        marketData.results.forEach(snapshot => {
            const blockNumber = snapshot.block_number;
            const snapshotDate = estimateDate(network, blockNumber);
            
            if (snapshotDate >= dateFrom && snapshotDate <= dateTo) {
                dataByPlatform[platform].liquidationProtection += snapshot.total_collateral_usd || 0;
            }
        });
    });
    
    // Хард-ликвидации
    if (processedData.hardLiquidationsList) {
        processedData.hardLiquidationsList.forEach(liq => {
            const liqDate = new Date(liq.date);
            if (liqDate >= dateFrom && liqDate <= dateTo) {
                if (networkFilter === 'all' || liq.network === networkFilter) {
                    // Determine platform by market name
                    const platform = 'LlamaLend'; // Default to LlamaLend as crvUSD rarely appears in hard liquidations
                    dataByPlatform[platform].fullLiquidations += liq.debt_repaid || 0;
                }
            }
        });
    }
    
    // Calculate funds saved
    Object.keys(dataByPlatform).forEach(platform => {
        dataByPlatform[platform].fundsSaved = 
            dataByPlatform[platform].liquidationProtection - dataByPlatform[platform].fullLiquidations;
    });
    
    const platforms = Object.keys(dataByPlatform);
    
    const trace1 = {
        x: platforms,
        y: platforms.map(p => dataByPlatform[p].liquidationProtection),
        name: 'Liquidation Protection',
        type: 'bar',
        marker: { color: '#ffd700' },
        text: platforms.map(p => `$${(dataByPlatform[p].liquidationProtection / 1000000).toFixed(2)}M`),
        textposition: 'outside'
    };
    
    const trace2 = {
        x: platforms,
        y: platforms.map(p => dataByPlatform[p].fullLiquidations),
        name: 'Full Liquidations',
        type: 'bar',
        marker: { color: '#ff6b6b' },
        text: platforms.map(p => `$${(dataByPlatform[p].fullLiquidations / 1000000).toFixed(2)}M`),
        textposition: 'outside'
    };
    
    const trace3 = {
        x: platforms,
        y: platforms.map(p => dataByPlatform[p].fundsSaved),
        name: 'Funds Saved',
        type: 'bar',
        marker: { color: '#4ecdc4' },
        text: platforms.map(p => `$${(dataByPlatform[p].fundsSaved / 1000000).toFixed(2)}M`),
        textposition: 'outside'
    };
    
    const layout = {
        barmode: 'group',
        xaxis: { 
            title: 'Platform'
        },
        yaxis: { 
            title: 'Value (USD)',
            tickformat: ',.0f'
        },
        hovermode: 'x unified',
        legend: {
            x: 0,
            y: 1,
            orientation: 'h'
        }
    };
    
    Plotly.newPlot('fundsSavedChart', [trace1, trace2, trace3], layout, {responsive: true});
}

// Update Top Tokens by Hard Liquidation chart
function updateTopTokensChart() {
    const networkFilter = document.getElementById('network').value;
    const dateFrom = new Date(document.getElementById('dateFrom').value);
    const dateTo = new Date(document.getElementById('dateTo').value);
    
    // Function to extract token from market/controller name
    function extractToken(market) {
        if (!market) return 'unknown';
        
        // Common token patterns in market names
        const tokenPatterns = {
            'wsteth': 'wstETH',
            'weth': 'WETH',
            'wbtc': 'WBTC',
            'sfrxeth': 'sfrxETH',
            'eth': 'ETH',
            'frxeth': 'frxETH',
            'yneth': 'ynETH',
            'pufeth': 'pufETH',
            'asdcrv': 'asdCRV',
            'arb': 'ARB',
            'crv': 'CRV',
            'fxs': 'FXS',
            'lbtc': 'lbtc',
            'weeeth': 'weETH',
            'usde': 'USDe',
            'usdc': 'USDC',
            'usdt': 'USDT'
        };
        
        const marketLower = market.toLowerCase();
        
        // Check for token patterns
        for (const [pattern, token] of Object.entries(tokenPatterns)) {
            if (marketLower.includes(pattern)) {
                return token;
            }
        }
        
        // If no pattern matches, try to extract from market name
        // Remove common prefixes/suffixes
        let cleaned = market.replace(/^0x[a-fA-F0-9]+$/i, 'unknown')
                           .replace(/-.*/, '')
                           .replace(/_.*/, '');
        
        return cleaned || 'unknown';
    }
    
    // Count hard liquidations by tokens
    const tokenData = {};
    
    if (processedData.hardLiquidationsList) {
        processedData.hardLiquidationsList.forEach(liq => {
            const liqDate = new Date(liq.date);
            if (liqDate >= dateFrom && liqDate <= dateTo) {
                if (networkFilter === 'all' || liq.network === networkFilter) {
                    const token = extractToken(liq.market);
                    
                    if (!tokenData[token]) {
                        tokenData[token] = 0;
                    }
                    
                    tokenData[token] += liq.debt_repaid || 0;
                }
            }
        });
    }
    
    // Sort and take top-15
    const sortedTokens = Object.entries(tokenData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
    
    const tokens = sortedTokens.map(t => t[0]);
    const values = sortedTokens.map(t => t[1]);
    
    const data = [{
        x: values,
        y: tokens,
        type: 'bar',
        orientation: 'h',
        marker: {
            color: values.map((v, i) => {
                // Gradient from dark green to light green (as in example)
                const greenValue = Math.floor(100 + (155 * (tokens.length - i - 1) / tokens.length));
                return `rgb(76, ${greenValue}, 80)`;
            })
        },
        text: values.map(v => `$${v.toLocaleString('en-US', {maximumFractionDigits: 0})}`),
        textposition: 'outside',
        textfont: {
            size: 11
        },
        hovertemplate: '%{y}: $%{x:,.0f}<extra></extra>'
    }];
    
    const layout = {
        title: 'Top Collateral Tokens by Full Liquidation Value',
        margin: { t: 40, l: 80, r: 120, b: 60 },
        xaxis: {
            title: 'Liquidation Value ($)',
            gridcolor: '#e0e0e0',
            tickformat: ',.0f',
            showgrid: true
        },
        yaxis: {
            automargin: true,
            tickfont: {
                size: 11
            }
        },
        plot_bgcolor: 'white',
        paper_bgcolor: 'white'
    };
    
    Plotly.newPlot('topTokensChart', data, layout, {responsive: true});
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Set default dates - last month
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    document.getElementById('dateFrom').value = monthAgo.toISOString().split('T')[0];
    document.getElementById('dateTo').value = today.toISOString().split('T')[0];
    
    // Load cache data
    loadCacheData();
});// Cache bust: Пн 18 авг 2025 09:26:57 EET
