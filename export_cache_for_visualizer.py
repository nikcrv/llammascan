#!/usr/bin/env python3
"""
Экспорт данных кеша для визуализатора
Создает cache_data.json файл для использования в HTML визуализаторе
"""
import json
import os
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)

def export_cache_data():
    """Экспортирует данные из scan_results_cache.json в формат для визуализатора"""
    
    # Проверяем наличие файла кеша
    cache_file = 'scan_results_cache.json'
    if not os.path.exists(cache_file):
        logging.error(f"Файл {cache_file} не найден!")
        return False
    
    # Загружаем кеш
    with open(cache_file, 'r') as f:
        cache_data = json.load(f)
    
    logging.info(f"Загружено {len(cache_data)} маркетов из кеша")
    
    # Добавляем дополнительную информацию для визуализации
    enhanced_data = {}
    
    for key, data in cache_data.items():
        # Парсим ключ для получения информации о сети и маркете
        parts = key.split('_')
        network = parts[0]
        market = parts[-1] if len(parts) > 2 else 'unknown'
        
        # Копируем данные
        enhanced_data[key] = data.copy()
        
        # Добавляем метаданные
        enhanced_data[key]['network'] = network
        enhanced_data[key]['market'] = market
        
        # Конвертируем scanned_ranges в range формат для совместимости
        if 'scanned_ranges' in data and 'range' not in data:
            # Берем минимальный и максимальный блоки из scanned_ranges
            all_blocks = []
            for range_pair in data['scanned_ranges']:
                all_blocks.extend(range_pair)
            if all_blocks:
                enhanced_data[key]['range'] = {
                    'from_block': min(all_blocks),
                    'to_block': max(all_blocks)
                }
        
        # Добавляем временные метки если их нет
        if 'results' in data:
            for result in data['results']:
                # Если есть block_number но нет timestamp, добавляем примерную дату
                if 'block_number' in result and 'timestamp' not in result:
                    # Примерная оценка даты по номеру блока
                    block_number = result['block_number']
                    estimated_date = estimate_date_from_block(network, block_number)
                    result['estimated_date'] = estimated_date.isoformat()
                
                # Добавляем расчеты если их нет
                if 'hard_liq_count' not in result:
                    total = result.get('total_positions', 0)
                    soft = result.get('soft_liq_count', 0)
                    ignored = result.get('ignored_positions', 0)
                    result['hard_liq_count'] = max(0, total - soft - ignored)
    
    # Сохраняем расширенные данные
    output_file = 'cache_data.json'
    with open(output_file, 'w') as f:
        json.dump(enhanced_data, f, indent=2)
    
    logging.info(f"Данные экспортированы в {output_file}")
    
    # Создаем сводную статистику
    print_summary(enhanced_data)
    
    return True

def estimate_date_from_block(network, block_number):
    """Примерная оценка даты по номеру блока"""
    
    # Референсные точки (блок -> дата)
    references = {
        'ethereum': {
            21515000: datetime(2025, 1, 1),
            21527368: datetime(2025, 1, 2),
            23134000: datetime(2025, 8, 13)
        },
        'arbitrum': {
            290658752: datetime(2025, 1, 1),
            290864657: datetime(2025, 1, 2),
            368368256: datetime(2025, 8, 14)
        },
        'fraxtal': {
            19840000: datetime(2025, 1, 1),
            19860000: datetime(2025, 1, 2),
            23000000: datetime(2025, 8, 14)
        }
    }
    
    # Среднее время блока в секундах
    block_times = {
        'ethereum': 12,
        'arbitrum': 0.25,
        'fraxtal': 2
    }
    
    if network not in references:
        return datetime.now()
    
    # Находим ближайшую референсную точку
    ref_blocks = sorted(references[network].keys())
    
    # Находим две ближайшие точки для интерполяции
    ref_block = ref_blocks[0]
    ref_date = references[network][ref_block]
    
    for block in ref_blocks:
        if block <= block_number:
            ref_block = block
            ref_date = references[network][block]
        else:
            break
    
    # Оцениваем дату
    block_diff = block_number - ref_block
    seconds_diff = block_diff * block_times.get(network, 12)
    estimated_date = datetime.fromtimestamp(ref_date.timestamp() + seconds_diff)
    
    return estimated_date

def print_summary(data):
    """Выводит сводную статистику"""
    
    total_soft = 0
    total_hard = 0
    total_volume = 0
    networks = set()
    markets = set()
    date_ranges = {}
    
    for key, market_data in data.items():
        network = market_data.get('network', 'unknown')
        market = market_data.get('market', 'unknown')
        
        networks.add(network)
        markets.add(market)
        
        if 'results' in market_data:
            for result in market_data['results']:
                total_soft += result.get('soft_liq_count', 0)
                total_hard += result.get('hard_liq_count', 0)
                total_volume += result.get('total_collateral_usd', 0)
                
                # Отслеживаем диапазон дат
                if 'estimated_date' in result:
                    date = result['estimated_date'][:10]
                    if network not in date_ranges:
                        date_ranges[network] = {'min': date, 'max': date}
                    else:
                        date_ranges[network]['min'] = min(date_ranges[network]['min'], date)
                        date_ranges[network]['max'] = max(date_ranges[network]['max'], date)
    
    print("\n" + "="*60)
    print("📊 СВОДНАЯ СТАТИСТИКА КЕША")
    print("="*60)
    print(f"🌐 Сетей: {len(networks)} - {', '.join(sorted(networks))}")
    print(f"📈 Маркетов: {len(markets)}")
    print(f"💧 Софт-ликвидаций: {total_soft:,}")
    print(f"🔥 Хард-ликвидаций: {total_hard:,}")
    print(f"💰 Общий объем: ${total_volume:,.2f}")
    
    if date_ranges:
        print("\n📅 Диапазоны дат по сетям:")
        for network, dates in sorted(date_ranges.items()):
            print(f"  {network}: {dates['min']} - {dates['max']}")
    
    print("="*60)
    print("\n✅ Данные готовы для визуализации!")
    print("📌 Откройте visualizer.html в браузере для просмотра графиков")

if __name__ == "__main__":
    success = export_cache_data()
    if not success:
        print("❌ Ошибка при экспорте данных")
    else:
        print("\n🚀 Для запуска визуализатора:")
        print("   1. python3 -m http.server 8000")
        print("   2. Откройте http://localhost:8000/visualizer.html")