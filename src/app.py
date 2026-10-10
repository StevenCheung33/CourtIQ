
from flask import Flask, render_template, request, jsonify
from pathlib import Path
from datetime import datetime, timedelta
import requests
import math
import logging
import json

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "basketball_courts.geojson"

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static")
)

logging.basicConfig(level=logging.INFO)

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
]

cache = {}
CACHE_DURATION = timedelta(minutes=30)


@app.route("/")
def home():
    return render_template("index.html")


def distance_miles(lat1, lon1, lat2, lon2):
    radius = 3958.7613

    lat1, lon1, lat2, lon2 = map(
        math.radians,
        [lat1, lon1, lat2, lon2]
    )

    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(delta_lon / 2) ** 2
    )

    return 2 * radius * math.asin(min(1, math.sqrt(a)))


def load_local_courts(latitude, longitude, radius_miles):
    if not DATA_FILE.exists():
        app.logger.warning("Local court dataset not found: %s", DATA_FILE)
        return []

    with DATA_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    courts = []

    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}

        # The existing CourtIQ dataset uses GeoJSON points.
        if geometry.get("type") != "Point":
            continue

        coordinates = geometry.get("coordinates") or []

        if len(coordinates) < 2:
            continue

        lon = float(coordinates[0])
        lat = float(coordinates[1])

        if distance_miles(latitude, longitude, lat, lon) > radius_miles:
            continue

        tags = properties.get("tags") or properties

        court_id = (
            properties.get("@id")
            or properties.get("id")
            or f"local/{lat}/{lon}"
        )

        courts.append({
            "id": str(court_id),
            "latitude": lat,
            "longitude": lon,
            "name": tags.get("name") or "Basketball Court",
            "hoops": tags.get("hoops") or "Unknown",
            "surface": tags.get("surface") or "Unknown",
            "lit": tags.get("lit") or "Unknown"
        })

    return courts


def fetch_live_courts(latitude, longitude, radius_miles):
    radius_meters = int(radius_miles * 1609.344)

    query = f"""
    [out:json][timeout:15];
    nwr["leisure"="pitch"]["sport"="basketball"]
    (around:{radius_meters},{latitude},{longitude});
    out center;
    """

    for server in OVERPASS_SERVERS:
        try:
            app.logger.info("Trying %s", server)

            response = requests.post(
                server,
                data={"data": query},
                headers={
                    "User-Agent": "CourtIQ-Student-Project/1.0",
                    "Accept": "application/json"
                },
                timeout=18
            )

            response.raise_for_status()
            data = response.json()

            if not isinstance(data.get("elements"), list):
                raise ValueError("Invalid Overpass response")

            courts = []

            for element in data["elements"]:
                lat = element.get("lat")
                lon = element.get("lon")

                if lat is None or lon is None:
                    center = element.get("center") or {}
                    lat = center.get("lat")
                    lon = center.get("lon")

                if lat is None or lon is None:
                    continue

                tags = element.get("tags") or {}

                courts.append({
                    "id": f"{element['type']}/{element['id']}",
                    "latitude": lat,
                    "longitude": lon,
                    "name": tags.get("name") or "Basketball Court",
                    "hoops": tags.get("hoops") or "Unknown",
                    "surface": tags.get("surface") or "Unknown",
                    "lit": tags.get("lit") or "Unknown"
                })

            app.logger.info("Live search found %s courts", len(courts))
            return courts

        except (requests.RequestException, ValueError) as error:
            app.logger.warning(
                "Overpass failed on %s: %s",
                server,
                error
            )

    return None


@app.route("/api/courts")
def get_courts():
    try:
        latitude = float(request.args["lat"])
        longitude = float(request.args["lon"])
        radius_miles = float(request.args.get("radius", 5))

        if not (-90 <= latitude <= 90):
            raise ValueError("Invalid latitude")

        if not (-180 <= longitude <= 180):
            raise ValueError("Invalid longitude")

        if not (0 < radius_miles <= 10):
            raise ValueError("Invalid radius")

    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Invalid search parameters"}), 400

    key = (round(latitude, 3), round(longitude, 3), radius_miles)

    cached = cache.get(key)

    if cached and datetime.now() - cached["time"] < CACHE_DURATION:
        return jsonify(cached["result"])

    courts = fetch_live_courts(
        latitude,
        longitude,
        radius_miles
    )

    if courts is not None:
        result = {
            "courts": courts,
            "source": "live"
        }
    else:
        local_courts = load_local_courts(
            latitude,
            longitude,
            radius_miles
        )

        result = {
            "courts": local_courts,
            "source": "local",
            "message": (
                "Live court data is unavailable. "
                "Showing locally saved courts where available."
            )
        }

    cache[key] = {
        "time": datetime.now(),
        "result": result
    }

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True)
