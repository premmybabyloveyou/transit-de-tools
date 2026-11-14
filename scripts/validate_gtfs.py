import sys
import os
import json

def parse_csv_line(line):
    """แยกคอลัมน์ CSV อย่างง่ายและลบอักขระส่วนเกิน"""
    return [col.strip().replace('"', '') for col in line.split(',')]

def convert_gtfs_to_geojson(gtfs_dir):
    stops_path = os.path.join(gtfs_dir, 'stops.txt')
    shapes_path = os.path.join(gtfs_dir, 'shapes.txt')
    routes_path = os.path.join(gtfs_dir, 'routes.txt')
    
    stops_count = 0
    routes_count = 0
    shapes_count = 0
    
    # -------------------------------------------------------------
    # 1. Convert stops.txt -> stops.geojson (Point Features)
    # -------------------------------------------------------------
    stops_features = []
    if os.path.exists(stops_path):
        with open(stops_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if len(lines) > 1:
                header = parse_csv_line(lines[0])
                lat_idx = header.index('stop_lat') if 'stop_lat' in header else -1
                lng_idx = header.index('stop_lon') if 'stop_lon' in header else -1
                id_idx = header.index('stop_id') if 'stop_id' in header else -1
                name_idx = header.index('stop_name') if 'stop_name' in header else -1

                for i, line in enumerate(lines[1:], start=1):
                    line_str = line.strip()
                    if not line_str:
                        continue
                    cols = parse_csv_line(line_str)
                    if len(cols) > max(lat_idx, lng_idx):
                        try:
                            lat = float(cols[lat_idx])
                            lng = float(cols[lng_idx])
                            stop_id = cols[id_idx] if id_idx != -1 else f"stop_{i}"
                            stop_name = cols[name_idx] if name_idx != -1 else "Transit Stop"

                            # สร้าง GeoJSON Point Feature (GeoJSON ใช้ลำดับ [lng, lat])
                            feature = {
                                "type": "Feature",
                                "geometry": {
                                    "type": "Point",
                                    "coordinates": [lng, lat]
                                },
                                "properties": {
                                    "stop_id": stop_id,
                                    "stop_name": stop_name
                                }
                            }
                            stops_features.append(feature)
                        except (ValueError, IndexError):
                            continue

        stops_count = len(stops_features)
        
        # บันทึกออกเป็น data/stops.geojson
        stops_geojson = {
            "type": "FeatureCollection",
            "features": stops_features
        }
        output_stops_path = os.path.join(gtfs_dir, '..', 'stops.geojson')
        with open(output_stops_path, 'w', encoding='utf-8') as f_out:
            json.dump(stops_geojson, f_out, ensure_ascii=False)

    # -------------------------------------------------------------
    # 2. Convert shapes.txt -> routes.geojson (LineString Features)
    # -------------------------------------------------------------
    shapes_features = []
    if os.path.exists(shapes_path):
        shapes_dict = {}
        with open(shapes_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if len(lines) > 1:
                header = parse_csv_line(lines[0])
                shape_id_idx = header.index('shape_id') if 'shape_id' in header else -1
                lat_idx = header.index('shape_pt_lat') if 'shape_pt_lat' in header else -1
                lng_idx = header.index('shape_pt_lon') if 'shape_pt_lon' in header else -1
                seq_idx = header.index('shape_pt_sequence') if 'shape_pt_sequence' in header else -1

                for line in lines[1:]:
                    line_str = line.strip()
                    if not line_str:
                        continue
                    cols = parse_csv_line(line_str)
                    if len(cols) > max(lat_idx, lng_idx):
                        try:
                            shape_id = cols[shape_id_idx]
                            lat = float(cols[lat_idx])
                            lng = float(cols[lng_idx])
                            seq = int(cols[seq_idx]) if seq_idx != -1 else 0

                            if shape_id not in shapes_dict:
                                shapes_dict[shape_id] = []
                            shapes_dict[shape_id].append((seq, [lng, lat]))
                        except (ValueError, IndexError):
                            continue

        # แปลงข้อมูลแต่ละ shape_id ให้เป็น LineString
        for shape_id, points in shapes_dict.items():
            # เรียงลำดับพิกัดตาม sequence
            sorted_pts = [pt[1] for pt in sorted(points, key=lambda x: x[0])]
            if len(sorted_pts) >= 2:
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": sorted_pts
                    },
                    "properties": {
                        "shape_id": shape_id
                    }
                }
                shapes_features.append(feature)

        shapes_count = len(shapes_features)

        # บันทึกออกเป็น data/routes.geojson
        routes_geojson = {
            "type": "FeatureCollection",
            "features": shapes_features
        }
        output_routes_path = os.path.join(gtfs_dir, '..', 'routes.geojson')
        with open(output_routes_path, 'w', encoding='utf-8') as f_out:
            json.dump(routes_geojson, f_out, ensure_ascii=False)

    # -------------------------------------------------------------
    # 3. Count routes.txt
    # -------------------------------------------------------------
    if os.path.exists(routes_path):
        with open(routes_path, 'r', encoding='utf-8') as f:
            lines = [l for l in f.readlines() if l.strip()]
            routes_count = max(0, len(lines) - 1)

    result = {
        "status": "success",
        "total_stops": stops_count,
        "total_routes": routes_count,
        "total_shapes": shapes_count,
        "gtfs_path": gtfs_dir,
        "stops_geojson_created": os.path.exists(os.path.join(gtfs_dir, '..', 'stops.geojson')),
        "routes_geojson_created": os.path.exists(os.path.join(gtfs_dir, '..', 'routes.geojson'))
    }

    # ส่งผลลัพธ์เป็น JSON ออกทาง stdout ให้ Node.js อ่าน
    print(json.dumps(result))

if __name__ == '__main__':
    target_dir = sys.argv[1] if len(sys.argv) > 1 else 'data/gtfs'
    convert_gtfs_to_geojson(target_dir)