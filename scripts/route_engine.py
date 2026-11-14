import sys
import os
import json
import math
import networkx as nx

def haversine(lat1, lon1, lat2, lon2):
    """คำนวณระยะทางบนผิวโลก (กิโลเมตร) ระหว่างสองพิกัด"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def find_nearest_stop(lat, lon, stops):
    """หาสถานี GTFS ที่ใกล้พิกัดที่กำหนดมากที่สุด"""
    min_dist = float('inf')
    nearest_stop = None
    for stop_id, s in stops.items():
        dist = haversine(lat, lon, s['lat'], s['lon'])
        if dist < min_dist:
            min_dist = dist
            nearest_stop = stop_id
    return nearest_stop, min_dist

def build_routing_graph(gtfs_dir):
    stops_path = os.path.join(gtfs_dir, 'stops.txt')
    shapes_path = os.path.join(gtfs_dir, 'shapes.txt')

    stops = {}
    if os.path.exists(stops_path):
        with open(stops_path, 'r', encoding='utf-8-sig') as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
            if lines:
                header = [h.replace('"', '').strip() for h in lines[0].split(',')]
                id_idx = header.index('stop_id') if 'stop_id' in header else 0
                
                lat_idx = -1
                if 'stop_lat' in header: lat_idx = header.index('stop_lat')
                
                lon_idx = -1
                if 'stop_lon' in header: lon_idx = header.index('stop_lon')
                elif 'stop_lng' in header: lon_idx = header.index('stop_lng')

                name_idx = header.index('stop_name') if 'stop_name' in header else -1

                for line in lines[1:]:
                    cols = [c.replace('"', '').strip() for c in line.split(',')]
                    if len(cols) > max(lat_idx, lon_idx) and lat_idx != -1 and lon_idx != -1:
                        try:
                            s_id = cols[id_idx]
                            lat = float(cols[lat_idx])
                            lon = float(cols[lon_idx])
                            name = cols[name_idx] if name_idx != -1 and len(cols) > name_idx else s_id
                            stops[s_id] = {'lat': lat, 'lon': lon, 'name': name}
                        except ValueError:
                            continue

    G = nx.DiGraph()
    for s_id, s_info in stops.items():
        G.add_node(s_id, lat=s_info['lat'], lon=s_info['lon'], name=s_info['name'])

    # สร้าง Edges เชื่อมต่อป้ายในระยะเดิน 500 เมตร (Spatial Proximity)
    stop_keys = list(stops.keys())
    for i, s1_id in enumerate(stop_keys):
        s1 = stops[s1_id]
        # สแกนป้ายเพื่อเชื่อมโยงเส้นทาง
        for s2_id in stop_keys[i+1:]:
            s2 = stops[s2_id]
            # กรองระยะทางคร่าวๆ จาก Lat/Lng ก่อนคำนวณจริงเพื่อความเร็ว
            if abs(s1['lat'] - s2['lat']) < 0.01 and abs(s1['lon'] - s2['lon']) < 0.01:
                dist = haversine(s1['lat'], s1['lon'], s2['lat'], s2['lon'])
                if dist <= 0.5: # ระยะเดิน 500 เมตร
                    G.add_edge(s1_id, s2_id, weight=dist)
                    G.add_edge(s2_id, s1_id, weight=dist)

    return G, stops

def calculate_route(gtfs_dir, start_lat, start_lon, end_lat, end_lon):
    G, stops = build_routing_graph(gtfs_dir)

    if not stops:
        return {
            "status": "fallback",
            "message": "No stops loaded",
            "coordinates": [[start_lat, start_lon], [end_lat, end_lon]]
        }

    origin_stop, start_dist = find_nearest_stop(start_lat, start_lon, stops)
    dest_stop, end_dist = find_nearest_stop(end_lat, end_lon, stops)

    if not origin_stop or not dest_stop:
        return {"status": "error", "message": "Stops not found"}

    try:
        path = nx.shortest_path(G, source=origin_stop, target=dest_stop, weight='weight')
        
        coordinates = [[start_lat, start_lon]]
        for s_id in path:
            coordinates.append([stops[s_id]['lat'], stops[s_id]['lon']])
        coordinates.append([end_lat, end_lon])

        return {
            "status": "success",
            "origin_stop": stops[origin_stop]['name'],
            "dest_stop": stops[dest_stop]['name'],
            "total_nodes": len(path),
            "coordinates": coordinates
        }
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        # Fallback หากไม่มีเส้นทางเชื่อมกันใน Graph
        coordinates = [[start_lat, start_lon]]
        if origin_stop: coordinates.append([stops[origin_stop]['lat'], stops[origin_stop]['lon']])
        if dest_stop: coordinates.append([stops[dest_stop]['lat'], stops[dest_stop]['lon']])
        coordinates.append([end_lat, end_lon])

        return {
            "status": "fallback",
            "origin_stop": stops[origin_stop]['name'] if origin_stop else "N/A",
            "dest_stop": stops[dest_stop]['name'] if dest_stop else "N/A",
            "total_nodes": len(coordinates),
            "coordinates": coordinates
        }

if __name__ == '__main__':
    gtfs_dir = sys.argv[1] if len(sys.argv) > 1 else 'data/gtfs'
    start_lat = float(sys.argv[2]) if len(sys.argv) > 2 else 13.7563
    start_lon = float(sys.argv[3]) if len(sys.argv) > 3 else 100.5018
    end_lat = float(sys.argv[4]) if len(sys.argv) > 4 else 13.7063
    end_lon = float(sys.argv[5]) if len(sys.argv) > 5 else 100.4272

    res = calculate_route(gtfs_dir, start_lat, start_lon, end_lat, end_lon)
    print(json.dumps(res, ensure_ascii=False))