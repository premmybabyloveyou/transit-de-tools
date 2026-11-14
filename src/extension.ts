import * as vscode from "vscode";
import * as mqtt from "mqtt";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";

const outputChannel = vscode.window.createOutputChannel("Transit DE Pipeline");

export function activate(context: vscode.ExtensionContext) {
  console.log("Transit DE Tools extension active!");

  let openMapCommand = vscode.commands.registerCommand(
    "transit.openRouteTester",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "routeTester",
        "Transit Route & GTFS Real-time Inspector",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      panel.webview.html = getWebviewContent();

      const loadRealGtfsFeed = () => {
        const gtfsDir = path.join(context.extensionPath, "data", "gtfs");
        const stopsPath = path.join(gtfsDir, "stops.txt");
        const shapesPath = path.join(gtfsDir, "shapes.txt");
        const routesPath = path.join(gtfsDir, "routes.txt");
        const tripsPath = path.join(gtfsDir, "trips.txt");

        const routeToShapeMap: { [routeId: string]: string[] } = {};

        // 0. Parse trips.txt (route_id -> shape_id mapping)
        if (fs.existsSync(tripsPath)) {
          try {
            const content = fs.readFileSync(tripsPath, "utf8");
            const lines = content.split("\n");
            const header = lines[0]
              .split(",")
              .map((h) => h.trim().replace(/"/g, ""));
            const rIdx = header.indexOf("route_id");
            const sIdx = header.indexOf("shape_id");

            if (rIdx !== -1 && sIdx !== -1) {
              for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const cols = line
                  .split(",")
                  .map((c) => c.trim().replace(/"/g, ""));
                const rId = cols[rIdx];
                const sId = cols[sIdx];
                if (rId && sId) {
                  if (!routeToShapeMap[rId]) routeToShapeMap[rId] = [];
                  if (!routeToShapeMap[rId].includes(sId)) {
                    routeToShapeMap[rId].push(sId);
                  }
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse trips.txt", e);
          }
        }

        // 1. Parse routes.txt (พร้อมแปลเขตการเดินรถ)
        if (fs.existsSync(routesPath)) {
          try {
            const content = fs.readFileSync(routesPath, "utf8");
            const lines = content.split("\n");
            const header = lines[0]
              .split(",")
              .map((h) => h.trim().replace(/"/g, ""));

            const idIdx = header.indexOf("route_id");
            const shortNameIdx = header.indexOf("route_short_name");
            const longNameIdx = header.indexOf("route_long_name");

            const routes: Array<{ id: string; name: string; zone: string }> =
              [];

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              const cols = line
                .split(",")
                .map((c) => c.trim().replace(/"/g, ""));
              if (cols.length > idIdx) {
                const rId = cols[idIdx];
                const shortName = cols[shortNameIdx] || "";
                const longName = cols[longNameIdx] || "";

                let zone = "เขตทั่วไป";
                if (rId.startsWith("1-") || shortName.startsWith("1-"))
                  zone = "เขต 1 (รังสิต/บางเขน)";
                else if (rId.startsWith("2-") || shortName.startsWith("2-"))
                  zone = "เขต 2 (มีนบุรี/สวนสยาม)";
                else if (rId.startsWith("3-") || shortName.startsWith("3-"))
                  zone = "เขต 3 (ปากน้ำ/สมุทรปราการ)";
                else if (rId.startsWith("4-") || shortName.startsWith("4-"))
                  zone = "เขต 4 (คลองเตย/พระราม 4)";
                else if (rId.startsWith("5-") || shortName.startsWith("5-"))
                  zone = "เขต 5 (แสมดำ/พระประแดง)";
                else if (rId.startsWith("6-") || shortName.startsWith("6-"))
                  zone = "เขต 6 (พุทธมณฑล/บางแค)";
                else if (rId.startsWith("7-") || shortName.startsWith("7-"))
                  zone = "เขต 7 (นนทบุรี/เตาปูน)";
                else if (rId.startsWith("8-") || shortName.startsWith("8-"))
                  zone = "เขต 8 (ห้วยขวาง/หมอชิต)";
                else if (rId.includes("BTS") || longName.includes("BTS"))
                  zone = "รถไฟฟ้า BTS";
                else if (rId.includes("MRT") || longName.includes("MRT"))
                  zone = "รถไฟฟ้า MRT";

                const displayName = longName
                  ? `[${zone}] สาย ${shortName || rId}: ${longName}`
                  : `[${zone}] สาย ${shortName || rId}`;

                routes.push({
                  id: rId,
                  name: displayName,
                  zone: zone,
                });
              }
            }

            panel.webview.postMessage({
              command: "renderGtfsRoutes",
              payload: routes,
            });
          } catch (err) {
            console.error("Failed to parse routes.txt:", err);
          }
        }

        // 2. Parse stops.txt
        if (fs.existsSync(stopsPath)) {
          try {
            const content = fs.readFileSync(stopsPath, "utf8");
            const lines = content.split("\n");
            const header = lines[0]
              .split(",")
              .map((h) => h.trim().replace(/"/g, ""));

            const latIdx = header.indexOf("stop_lat");
            const lngIdx = header.indexOf("stop_lon");
            const nameIdx = header.indexOf("stop_name");
            const idIdx = header.indexOf("stop_id");

            const stops: Array<{
              id: string;
              name: string;
              lat: number;
              lng: number;
            }> = [];

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              const cols = line
                .split(",")
                .map((c) => c.trim().replace(/"/g, ""));
              if (cols.length > Math.max(latIdx, lngIdx)) {
                const lat = parseFloat(cols[latIdx]);
                const lng = parseFloat(cols[lngIdx]);
                if (!isNaN(lat) && !isNaN(lng)) {
                  stops.push({
                    id: cols[idIdx] || `stop_${i}`,
                    name: cols[nameIdx] || "Transit Stop",
                    lat,
                    lng,
                  });
                }
              }
            }

            panel.webview.postMessage({
              command: "renderGtfsStops",
              payload: stops,
            });
          } catch (err) {
            console.error("Failed to parse stops.txt:", err);
          }
        }

        // 3. Parse shapes.txt
        if (fs.existsSync(shapesPath)) {
          try {
            const content = fs.readFileSync(shapesPath, "utf8");
            const lines = content.split("\n");
            const header = lines[0]
              .split(",")
              .map((h) => h.trim().replace(/"/g, ""));

            const shapeIdIdx = header.indexOf("shape_id");
            const latIdx = header.indexOf("shape_pt_lat");
            const lngIdx = header.indexOf("shape_pt_lon");
            const seqIdx = header.indexOf("shape_pt_sequence");

            const shapesMap: {
              [shapeId: string]: Array<{
                lat: number;
                lng: number;
                seq: number;
              }>;
            } = {};

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              const cols = line
                .split(",")
                .map((c) => c.trim().replace(/"/g, ""));

              const shapeId = cols[shapeIdIdx];
              const lat = parseFloat(cols[latIdx]);
              const lng = parseFloat(cols[lngIdx]);
              const seq = parseInt(cols[seqIdx] || "0", 10);

              if (shapeId && !isNaN(lat) && !isNaN(lng)) {
                if (!shapesMap[shapeId]) shapesMap[shapeId] = [];
                shapesMap[shapeId].push({ lat, lng, seq });
              }
            }

            const shapeLines = Object.keys(shapesMap).map((shapeId) => {
              const sortedPts = shapesMap[shapeId].sort(
                (a, b) => a.seq - b.seq
              );
              return {
                shapeId,
                coordinates: sortedPts.map((pt) => [pt.lat, pt.lng]),
              };
            });

            panel.webview.postMessage({
              command: "renderGtfsShapes",
              payload: {
                shapes: shapeLines,
                routeToShapeMap: routeToShapeMap,
              },
            });
          } catch (err) {
            console.error("Failed to parse shapes.txt:", err);
          }
        }
      };

      setTimeout(loadRealGtfsFeed, 800);

      // เรียก Python Route Engine คำนวณ Multimodal Shortest Path ผ่าน NetworkX
      panel.webview.onDidReceiveMessage(
        (message) => {
          if (message.command === "routePointsSelected") {
            const { origin, destination } = message.payload;

            outputChannel.show(true);
            outputChannel.appendLine(
              `[${new Date().toLocaleTimeString()}] Calculating Multimodal Path from NetworkX Graph...`
            );

            const scriptPath = path.join(
              context.extensionPath,
              "scripts",
              "route_engine.py"
            );
            const gtfsDir = path.join(context.extensionPath, "data", "gtfs");

            const venvPythonPath = path.join(
              context.extensionPath,
              ".venv",
              "bin",
              "python3"
            );

            const pythonExecutable = fs.existsSync(venvPythonPath)
              ? venvPythonPath
              : "python3";

            execFile(
              pythonExecutable,
              [
                scriptPath,
                gtfsDir,
                origin.lat.toString(),
                origin.lng.toString(),
                destination.lat.toString(),
                destination.lng.toString(),
              ],
              (error, stdout, stderr) => {
                if (error) {
                  outputChannel.appendLine(
                    `[ERROR] Routing Failed: ${error.message}`
                  );
                  return;
                }

                try {
                  const res = JSON.parse(stdout);
                  if (res.status === "success" || res.status === "fallback") {
                    outputChannel.appendLine(
                      `[SUCCESS] Path Calculated! Nodes visited: ${
                        res.total_nodes || 2
                      }`
                    );
                    outputChannel.appendLine(
                      `Nearest Origin Stop     : ${res.origin_stop || "N/A"}`
                    );
                    outputChannel.appendLine(
                      `Nearest Destination Stop: ${res.dest_stop || "N/A"}`
                    );

                    panel.webview.postMessage({
                      command: "drawPlannedRoute",
                      payload: {
                        coordinates: res.coordinates,
                      },
                    });

                    vscode.window.showInformationMessage(
                      `Calculated route via ${
                        res.origin_stop || "Selected Location"
                      }`
                    );
                  }
                } catch (e) {
                  outputChannel.appendLine(`[RAW OUTPUT]: ${stdout}`);
                }
              }
            );
          }
        },
        undefined,
        context.subscriptions
      );

      // เชื่อมต่อ MQTT Stream โดยใช้ EMQX Public Broker (wss พอร์ต 8084) ที่เสถียรกว่า
      const client = mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
        keepalive: 30, // ส่ง Ping รักษาการเชื่อมต่อทุก 30 วินาที
        reconnectPeriod: 3000, // หากสายหลุด ให้พยายามต่อใหม่ทุก 3 วินาที
        connectTimeout: 10000, // ขยายเวลา Timeout เป็น 10 วินาทีเพื่อป้องกัน connack timeout
        clientId: `transit_de_${Math.random().toString(16).substring(2, 10)}`, // สุ่ม Client ID ป้องกัน ID ชนกัน
      });

      client.on("connect", () => {
        outputChannel.appendLine(
          `[${new Date().toLocaleTimeString()}] MQTT Connected to EMQX Broker (wss://broker.emqx.io:8084/mqtt)`
        );
        client.subscribe("bangkok/transit/gps", (err) => {
          if (!err) {
            outputChannel.appendLine(
              `[MQTT] Subscribed to topic: bangkok/transit/gps`
            );
          } else {
            outputChannel.appendLine(
              `[MQTT Error] Subscribe failed: ${err.message}`
            );
          }
        });
      });

      client.on("error", (err) => {
        outputChannel.appendLine(
          `[MQTT Error] Connection failed: ${err.message}`
        );
      });

      client.on("reconnect", () => {
        outputChannel.appendLine(
          `[MQTT Status] Reconnecting to EMQX broker...`
        );
      });

      client.on("message", (topic, message) => {
        try {
          const gpsData = JSON.parse(message.toString());
          outputChannel.appendLine(
            `[MQTT Stream] Received Vehicle GPS: ID=${
              gpsData.vehicleId || "BUS-01"
            } Lat=${gpsData.lat} Lng=${gpsData.lng}`
          );

          panel.webview.postMessage({
            command: "updateVehicleLocation",
            payload: {
              id: gpsData.vehicleId || "BUS-01",
              lat: gpsData.lat,
              lng: gpsData.lng,
              timestamp: new Date().toLocaleTimeString(),
            },
          });
        } catch (e) {
          console.error("Invalid MQTT Message", e);
        }
      });

      panel.onDidDispose(
        () => {
          client.end();
        },
        null,
        context.subscriptions
      );
    }
  );

  let runPipelineCommand = vscode.commands.registerCommand(
    "transit.runAirflowETL",
    () => {
      outputChannel.show(true);
      outputChannel.appendLine(
        `[${new Date().toLocaleTimeString()}] Starting Python GTFS Analytics Pipeline...`
      );
      const scriptPath = path.join(
        context.extensionPath,
        "scripts",
        "validate_gtfs.py"
      );
      const gtfsDir = path.join(context.extensionPath, "data", "gtfs");

      execFile("python3", [scriptPath, gtfsDir], (error, stdout, stderr) => {
        if (error) {
          outputChannel.appendLine(`[ERROR] ${error.message}`);
          vscode.window.showErrorMessage(
            "Pipeline Execution Failed! Check Output Panel."
          );
          return;
        }

        try {
          const result = JSON.parse(stdout);
          outputChannel.appendLine(`----------------------------------------`);
          outputChannel.appendLine(
            `[SUCCESS] GTFS Analytics & GeoJSON Export Completed!`
          );
          outputChannel.appendLine(
            `Total Stops Exported : ${result.total_stops.toLocaleString()}`
          );
          outputChannel.appendLine(
            `Total Routes Parsed   : ${result.total_routes.toLocaleString()}`
          );
          outputChannel.appendLine(
            `Total Shape Lines    : ${result.total_shapes.toLocaleString()}`
          );
          outputChannel.appendLine(
            `Stops GeoJSON Created : ${
              result.stops_geojson_created ? "YES (data/stops.geojson)" : "NO"
            }`
          );
          outputChannel.appendLine(
            `Routes GeoJSON Created: ${
              result.routes_geojson_created ? "YES (data/routes.geojson)" : "NO"
            }`
          );
          outputChannel.appendLine(`----------------------------------------`);

          vscode.window.showInformationMessage(
            `GTFS Pipeline Finished! Stops: ${result.total_stops}, Routes: ${result.total_routes}`
          );
        } catch (parseError) {
          outputChannel.appendLine(`[RAW OUTPUT]: ${stdout}`);
        }
      });
    }
  );

  const treeDataProvider = new TransitDETreeProvider();
  vscode.window.registerTreeDataProvider("transit-de-menu", treeDataProvider);

  context.subscriptions.push(openMapCommand, runPipelineCommand);
}

function getWebviewContent(): string {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'unrestricted' 'unsafe-inline' 'unsafe-eval' https: data: blob: wss:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transit Tester</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
    <style>
      html, body { height: 100%; margin: 0; padding: 12px; box-sizing: border-box; font-family: -apple-system, sans-serif; color: white; background-color: #1e1e1e; }
      #map { height: 78vh; width: 100%; border-radius: 8px; margin-top: 10px; border: 1px solid #444; }
      .status { font-size: 12px; color: #4ec9b0; margin-bottom: 5px; }
      .controls { display: flex; flex-direction: column; gap: 8px; background: #252526; padding: 10px; border-radius: 6px; border: 1px solid #3c3c3c; }
      .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .filter-group { display: flex; gap: 8px; align-items: center; }
      select { background: #1e1e1e; color: #ccc; border: 1px solid #3c3c3c; padding: 5px 8px; border-radius: 4px; font-size: 12px; max-width: 300px; }
      .btn { background: #0e639c; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; }
      .btn:hover { background: #1177bb; }
      .toggle-btn { background: #333; color: #4ec9b0; border: 1px solid #4ec9b0; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
      .toggle-btn.active { background: #4ec9b0; color: #1e1e1e; font-weight: bold; }
      .bus-pin { display: flex; align-items: center; justify-content: center; font-size: 20px; line-height: 1; filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.5)); }
    </style>
  </head>
  <body>
    <h2>Transit DE: Real GTFS Spatial Inspector</h2>
    <div class="controls">
      <div class="row">
        <div class="filter-group">
          <label>🟢 Origin: </label>
          <select id="originSelect" onchange="onStationSelect()">
            <option value="">-- Select Origin Station --</option>
          </select>

          <label>🔴 Destination: </label>
          <select id="destSelect" onchange="onStationSelect()">
            <option value="">-- Select Destination Station --</option>
          </select>
        </div>

        <div class="filter-group">
          <button id="heatmapToggle" class="toggle-btn" onclick="toggleHeatmap()">🔥 Toggle Density Heatmap</button>
          <label for="routeSelect">Route Line Filter: </label>
          <select id="routeSelect" onchange="filterRoutes()">
            <option value="ALL">-- Show All Routes --</option>
          </select>
          <button class="btn" onclick="resetPoints()">Reset Pins</button>
        </div>
      </div>
      <div class="status" id="status">Status: Loading GTFS data...</div>
    </div>
    <div id="map"></div>

    <script>
      const vscode = acquireVsCodeApi();
      let map;
      const vehicleMarkers = {};
      let startMarker = null;
      let endMarker = null;
      let routePolyline = null;
      let bufferCircle = null;
      
      let allShapes = {};
      let routeToShapeMap = {};
      let stopGroup = L.featureGroup();
      let heatLayer = null;
      let isHeatmapActive = false;
      let rawStopsList = [];
      let allStopsMap = {};

      function initMap() {
        map = L.map('map').setView([13.7563, 100.5018], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(map);

        stopGroup.addTo(map);

        map.on('click', function(e) {
          if (!startMarker) {
            setOriginPin(e.latlng.lat, e.latlng.lng, 'Selected Point');
            document.getElementById('status').innerText = 'Origin set! Click map or select Destination.';
          } else if (!endMarker) {
            setDestPin(e.latlng.lat, e.latlng.lng, 'Selected Point');
            triggerRouting();
          }
        });

        setTimeout(() => { map.invalidateSize(); }, 300);
      }

      function setOriginPin(lat, lng, name) {
        if (startMarker) map.removeLayer(startMarker);
        if (bufferCircle) map.removeLayer(bufferCircle);

        startMarker = L.marker([lat, lng], {
          icon: L.divIcon({ className: 'pin', html: '🟢', iconSize: [20, 20] })
        }).addTo(map).bindPopup(\`<b>Origin: \${name}</b>\`).openPopup();

        bufferCircle = L.circle([lat, lng], {
          radius: 500,
          color: '#4ec9b0',
          fillColor: '#4ec9b0',
          fillOpacity: 0.15,
          weight: 1.5,
          dashArray: '4, 4'
        }).addTo(map);
      }

      function setDestPin(lat, lng, name) {
        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.marker([lat, lng], {
          icon: L.divIcon({ className: 'pin', html: '🔴', iconSize: [20, 20] })
        }).addTo(map).bindPopup(\`<b>Destination: \${name}</b>\`).openPopup();
      }

      function onStationSelect() {
        const originId = document.getElementById('originSelect').value;
        const destId = document.getElementById('destSelect').value;

        if (originId && allStopsMap[originId]) {
          const stop = allStopsMap[originId];
          setOriginPin(stop.lat, stop.lng, stop.name);
        }

        if (destId && allStopsMap[destId]) {
          const stop = allStopsMap[destId];
          setDestPin(stop.lat, stop.lng, stop.name);
        }

        if (startMarker && endMarker) {
          const group = L.featureGroup([startMarker, endMarker]);
          map.fitBounds(group.getBounds(), { padding: [50, 50] });
          triggerRouting();
        }
      }

      function triggerRouting() {
        if (startMarker && endMarker) {
          document.getElementById('status').innerText = 'Route selected! Querying spatial engine...';
          vscode.postMessage({
            command: 'routePointsSelected',
            payload: { origin: startMarker.getLatLng(), destination: endMarker.getLatLng() }
          });
        }
      }

      function resetPoints() {
        if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
        if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
        if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
        if (bufferCircle) { map.removeLayer(bufferCircle); bufferCircle = null; }
        document.getElementById('originSelect').value = '';
        document.getElementById('destSelect').value = '';
        document.getElementById('status').innerText = 'Status: Select Origin & Destination from Dropdown or Click Map';
      }

      function toggleHeatmap() {
        const toggleBtn = document.getElementById('heatmapToggle');
        isHeatmapActive = !isHeatmapActive;

        if (isHeatmapActive) {
          toggleBtn.classList.add('active');
          map.removeLayer(stopGroup);

          if (!heatLayer && rawStopsList.length > 0) {
            const heatPoints = rawStopsList.map(s => [s.lat, s.lng, 0.6]);
            heatLayer = L.heatLayer(heatPoints, {
              radius: 15,
              blur: 20,
              maxZoom: 15,
              gradient: { 0.4: 'blue', 0.65: 'lime', 1: 'red' }
            });
          }
          if (heatLayer) heatLayer.addTo(map);
          document.getElementById('status').innerText = 'Displaying GTFS Density Heatmap (Hotspots of stops).';
        } else {
          toggleBtn.classList.remove('active');
          if (heatLayer) map.removeLayer(heatLayer);
          stopGroup.addTo(map);
          document.getElementById('status').innerText = 'Displaying Standard Circle Markers.';
        }
      }

      function filterRoutes() {
        const selectedRouteId = document.getElementById('routeSelect').value;
        const visibleGroup = L.featureGroup();

        if (selectedRouteId === 'ALL') {
          Object.keys(allShapes).forEach(sId => {
            allShapes[sId].addTo(map);
            visibleGroup.addLayer(allShapes[sId]);
          });
          document.getElementById('status').innerText = 'Showing ALL Route lines.';
        } else {
          Object.keys(allShapes).forEach(sId => {
            map.removeLayer(allShapes[sId]);
          });

          const activeShapes = routeToShapeMap[selectedRouteId] || [];
          let shownCount = 0;

          activeShapes.forEach(sId => {
            if (allShapes[sId]) {
              allShapes[sId].addTo(map);
              visibleGroup.addLayer(allShapes[sId]);
              shownCount++;
            }
          });

          if (shownCount > 0) {
            map.fitBounds(visibleGroup.getBounds(), { padding: [40, 40] });
            document.getElementById('status').innerText = \`Filtered Route [\${selectedRouteId}]: Displaying \${shownCount} shapes.\`;
          } else {
            document.getElementById('status').innerText = \`Filtered Route [\${selectedRouteId}]: No shape polyline found in GTFS shapes.txt.\`;
          }
        }
      }

      // Smooth Animation Helper สำหรับเลื่อนหมุดรถแบบลื่นไหล
      function animateMarker(marker, startLatLng, endLatLng, duration) {
        let start = null;
        const startLat = startLatLng[0];
        const startLng = startLatLng[1];
        const endLat = endLatLng[0];
        const endLng = endLatLng[1];

        function step(timestamp) {
          if (!start) start = timestamp;
          const progress = Math.min((timestamp - start) / duration, 1);
          
          const currentLat = startLat + (endLat - startLat) * progress;
          const currentLng = startLng + (endLng - startLng) * progress;
          
          marker.setLatLng([currentLat, currentLng]);

          if (progress < 1) {
            requestAnimationFrame(step);
          }
        }
        requestAnimationFrame(step);
      }

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initMap();
      } else {
        window.addEventListener('DOMContentLoaded', initMap);
      }

      window.addEventListener('message', event => {
        const message = event.data;

        if (message.command === 'renderGtfsRoutes') {
          const select = document.getElementById('routeSelect');
          const frag = document.createDocumentFragment();
          message.payload.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.innerText = r.name;
            frag.appendChild(opt);
          });
          select.appendChild(frag);
        }

        if (message.command === 'renderGtfsStops') {
          const stops = message.payload;
          rawStopsList = stops;
          const myCanvasRenderer = L.canvas({ padding: 0.5 });
          stopGroup.clearLayers();

          const originSel = document.getElementById('originSelect');
          const destSel = document.getElementById('destSelect');

          const fragOrigin = document.createDocumentFragment();
          const fragDest = document.createDocumentFragment();
          const displayLimit = Math.min(stops.length, 3000);

          for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            allStopsMap[stop.id] = stop;

            L.circleMarker([stop.lat, stop.lng], {
              renderer: myCanvasRenderer,
              radius: 2,
              color: '#007acc',
              fillColor: '#007acc',
              fillOpacity: 0.6
            }).addTo(stopGroup).bindPopup(\`<b>\${stop.name}</b><br>ID: \${stop.id}\`);

            if (i < displayLimit) {
              const labelText = \`\${stop.name} (\${stop.id})\`;

              const opt1 = document.createElement('option');
              opt1.value = stop.id;
              opt1.innerText = labelText;
              fragOrigin.appendChild(opt1);

              const opt2 = document.createElement('option');
              opt2.value = stop.id;
              opt2.innerText = labelText;
              fragDest.appendChild(opt2);
            }
          }

          originSel.appendChild(fragOrigin);
          destSel.appendChild(fragDest);

          if (stops.length > 0) {
            map.fitBounds(stopGroup.getBounds(), { padding: [20, 20] });
          }
          document.getElementById('status').innerText = \`Rendered \${stops.length.toLocaleString()} GTFS Stops.\`;
        }

        if (message.command === 'renderGtfsShapes') {
          const { shapes, routeToShapeMap: rMap } = message.payload;
          routeToShapeMap = rMap || {};

          shapes.forEach(s => {
            const line = L.polyline(s.coordinates, {
              color: '#ff4d4d',
              weight: 4,
              opacity: 0.8
            });
            allShapes[s.shapeId] = line;
            line.addTo(map);
          });
        }

        if (message.command === 'drawPlannedRoute') {
          const coords = message.payload.coordinates;
          if (routePolyline) map.removeLayer(routePolyline);

          routePolyline = L.polyline(coords, {
            color: '#00e676',
            weight: 6,
            opacity: 0.9,
            lineJoin: 'round'
          }).addTo(map);

          map.fitBounds(routePolyline.getBounds(), { padding: [50, 50] });
          document.getElementById('status').innerText = \`Multimodal Route Calculated: \${coords.length} waypoints via NetworkX Graph.\`;
        }

        // จัดการ Smooth Animation สำหรับยานพาหนะ Real-time GPS สตรีมมิ่ง
        if (message.command === 'updateVehicleLocation') {
          const { id, lat, lng, timestamp } = message.payload;
          if (lat && lng) {
            const newPos = [lat, lng];

            if (vehicleMarkers[id]) {
              const oldPos = [vehicleMarkers[id].getLatLng().lat, vehicleMarkers[id].getLatLng().lng];
              animateMarker(vehicleMarkers[id], oldPos, newPos, 1000);
              vehicleMarkers[id].getPopup().setContent(\`
                <div style="font-size:12px;">
                  <b>🚌 Vehicle ID:</b> \${id}<br/>
                  <b>📍 Position:</b> \${lat.toFixed(4)}, \${lng.toFixed(4)}<br/>
                  <b>⏱️ Last Update:</b> \${timestamp}<br/>
                  <b>Status:</b> <span style="color:#00e676;">LIVE STREAMING</span>
                </div>
              \`);
            } else {
              const busIcon = L.divIcon({
                className: 'bus-pin',
                html: '<div style="font-size: 20px;">🚌</div>',
                iconSize: [25, 25]
              });

              vehicleMarkers[id] = L.marker(newPos, { icon: busIcon })
                .addTo(map)
                .bindPopup(\`
                  <div style="font-size:12px;">
                    <b>🚌 Vehicle ID:</b> \${id}<br/>
                    <b>📍 Position:</b> \${lat.toFixed(4)}, \${lng.toFixed(4)}<br/>
                    <b>⏱️ Last Update:</b> \${timestamp}<br/>
                    <b>Status:</b> <span style="color:#00e676;">LIVE STREAMING</span>
                  </div>
                \`);
            }
          }
        }
      });
    </script>
  </body>
  </html>`;
}

class TransitDETreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
  getChildren(): Thenable<vscode.TreeItem[]> {
    const itemMap = new vscode.TreeItem("Open Live Stream & GTFS Map");
    itemMap.iconPath = new vscode.ThemeIcon("map");
    itemMap.command = { command: "transit.openRouteTester", title: "Open Map" };

    const itemAirflow = new vscode.TreeItem("Run Airflow ETL Pipeline");
    itemAirflow.iconPath = new vscode.ThemeIcon("play-circle");
    itemAirflow.command = {
      command: "transit.runAirflowETL",
      title: "Run Pipeline",
    };

    return Promise.resolve([itemMap, itemAirflow]);
  }
}

export function deactivate() {}
