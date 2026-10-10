
from flask import Flask, render_template, request, jsonify
from pathlib import Path
from datetime import datetime, timedelta, timezone
import sqlite3
import requests
import logging
import json
import math
import re

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "basketball_courts.geojson"
DATABASE_FILE = DATA_DIR / "courtiq.db"

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

court_cache = {}
CACHE_DURATION = timedelta(minutes=30)


# ----------------------------
# DATABASE
# ----------------------------

def get_db_connection():
    connection = sqlite3.connect(
        DATABASE_FILE,
        timeout=10
    )
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with get_db_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                court_id TEXT NOT NULL,
                reviewer_name TEXT NOT NULL,
                rating INTEGER NOT NULL
                    CHECK (rating BETWEEN 1 AND 5),
                comment TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS
                idx_reviews_court_id
            ON reviews (court_id)
        """)

        connection.commit()

    app.logger.info(
        "CourtIQ database ready: %s",
        DATABASE_FILE
    )


def valid_court_id(court_id):
    return (
        isinstance(court_id, str)
        and len(court_id) <= 100
        and re.fullmatch(
            r"(node|way|relation)/[0-9]+",
            court_id
        ) is not None
    )


def review_summary(court_id):
    with get_db_connection() as connection:
        summary = connection.execute("""
            SELECT
                COUNT(*) AS review_count,
                ROUND(AVG(rating), 1) AS average_rating
            FROM reviews
            WHERE court_id = ?
        """, (court_id,)).fetchone()

    return {
        "review_count": summary["review_count"],
        "average_rating": summary["average_rating"]
    }


# ----------------------------
# MAIN PAGE
# ----------------------------

@app.route("/")
def home():
    return render_template("index.html")


# ----------------------------
# DISTANCE CALCULATION
# ----------------------------

def distance_miles(lat1, lon1, lat2, lon2):
    earth_radius = 3958.7613

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

    return (
        2 * earth_radius
        * math.asin(min(1, math.sqrt(a)))
    )


# ----------------------------
# LOCAL GEOJSON FALLBACK
# ----------------------------

def load_local_courts(latitude, longitude, radius_miles):
    if not DATA_FILE.exists():
        app.logger.warning(
            "Local GeoJSON file missing: %s",
            DATA_FILE
        )
        return []

    try:
        with DATA_FILE.open(
            "r",
            encoding="utf-8"
        ) as file:
            data = json.load(file)

    except (OSError, ValueError) as error:
        app.logger.error(
            "Could not read GeoJSON: %s",
            error
        )
        return []

    courts = []

    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}

        if geometry.get("type") != "Point":
            continue

        coordinates = geometry.get("coordinates") or []

        if len(coordinates) < 2:
            continue

        try:
            lon = float(coordinates[0])
            lat = float(coordinates[1])
        except (TypeError, ValueError):
            continue

        if not (
            math.isfinite(lat)
            and math.isfinite(lon)
        ):
            continue

        distance = distance_miles(
            latitude,
            longitude,
            lat,
            lon
        )

        if distance > radius_miles:
            continue

        tags = properties.get("tags") or properties

        # Use the original OSM ID for stable review storage.
        court_id = (
            properties.get("@id")
            or properties.get("id")
            or feature.get("id")
        )

        court_id = str(court_id or "")

        if not valid_court_id(court_id):
            osm_type = (
                properties.get("@type")
                or properties.get("type")
            )
            osm_id = properties.get("@id")

            if (
                osm_type in ("node", "way", "relation")
                and str(osm_id).isdigit()
            ):
                court_id = f"{osm_type}/{osm_id}"

        if not valid_court_id(court_id):
            # We do not invent unstable court IDs.
            continue

        courts.append({
            "id": court_id,
            "latitude": lat,
            "longitude": lon,
            "name": tags.get("name") or "Basketball Court",
            "hoops": tags.get("hoops") or "Unknown",
            "surface": tags.get("surface") or "Unknown",
            "lit": tags.get("lit") or "Unknown"
        })

    app.logger.info(
        "Loaded %s nearby courts from GeoJSON",
        len(courts)
    )

    return courts


# ----------------------------
# LIVE OVERPASS COURTS
# ----------------------------

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
            app.logger.info(
                "Trying Overpass: %s",
                server
            )

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

                court_id = (
                    f"{element['type']}/{element['id']}"
                )

                if not valid_court_id(court_id):
                    continue

                courts.append({
                    "id": court_id,
                    "latitude": lat,
                    "longitude": lon,
                    "name": tags.get("name") or "Basketball Court",
                    "hoops": tags.get("hoops") or "Unknown",
                    "surface": tags.get("surface") or "Unknown",
                    "lit": tags.get("lit") or "Unknown"
                })

            app.logger.info(
                "Found %s live courts",
                len(courts)
            )

            return courts

        except (requests.RequestException, ValueError) as error:
            app.logger.warning(
                "Overpass failed on %s: %s",
                server,
                error
            )

    return None


# ----------------------------
# COURT SEARCH API
# ----------------------------

@app.route("/api/courts", methods=["GET"])
def get_courts():
    try:
        latitude = float(request.args["lat"])
        longitude = float(request.args["lon"])
        radius_miles = float(
            request.args.get("radius", 5)
        )

        if not (
            math.isfinite(latitude)
            and -90 <= latitude <= 90
        ):
            raise ValueError("Invalid latitude")

        if not (
            math.isfinite(longitude)
            and -180 <= longitude <= 180
        ):
            raise ValueError("Invalid longitude")

        if not (
            math.isfinite(radius_miles)
            and 0 < radius_miles <= 10
        ):
            raise ValueError("Invalid radius")

    except (KeyError, TypeError, ValueError):
        return jsonify({
            "error": "Invalid search parameters"
        }), 400

    cache_key = (
        round(latitude, 3),
        round(longitude, 3),
        radius_miles
    )

    cached = court_cache.get(cache_key)

    if cached:
        age = datetime.now(timezone.utc) - cached["time"]

        if age < CACHE_DURATION:
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
                "Showing saved local courts where available."
            )
        }

    court_cache[cache_key] = {
        "time": datetime.now(timezone.utc),
        "result": result
    }

    return jsonify(result)


# ----------------------------
# GET REVIEWS FOR A COURT
# ----------------------------

@app.route(
    "/api/courts/<path:court_id>/reviews",
    methods=["GET"]
)
def get_reviews(court_id):
    if not valid_court_id(court_id):
        return jsonify({
            "error": "Invalid court ID"
        }), 400

    with get_db_connection() as connection:
        rows = connection.execute("""
            SELECT
                id,
                court_id,
                reviewer_name,
                rating,
                comment,
                created_at
            FROM reviews
            WHERE court_id = ?
            ORDER BY id DESC
        """, (court_id,)).fetchall()

    reviews = [dict(row) for row in rows]

    summary = review_summary(court_id)

    return jsonify({
        "court_id": court_id,
        "reviews": reviews,
        "review_count": summary["review_count"],
        "average_rating": summary["average_rating"]
    })


# ----------------------------
# SUBMIT A NEW REVIEW
# ----------------------------

@app.route(
    "/api/courts/<path:court_id>/reviews",
    methods=["POST"]
)
def add_review(court_id):
    if not valid_court_id(court_id):
        return jsonify({
            "error": "Invalid court ID"
        }), 400

    if not request.is_json:
        return jsonify({
            "error": "Please submit JSON data"
        }), 415

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "Invalid review data"
        }), 400

    name = data.get("name", "")
    rating = data.get("rating")
    comment = data.get("comment", "")

    if not isinstance(name, str):
        return jsonify({
            "error": "Invalid reviewer name"
        }), 400

    if not isinstance(comment, str):
        return jsonify({
            "error": "Invalid review text"
        }), 400

    name = name.strip()
    comment = comment.strip()

    if not (1 <= len(name) <= 50):
        return jsonify({
            "error": "Name must be 1–50 characters"
        }), 400

    if not (1 <= len(comment) <= 1000):
        return jsonify({
            "error": "Review must be 1–1000 characters"
        }), 400

    if (
        type(rating) is not int
        or not (1 <= rating <= 5)
    ):
        return jsonify({
            "error": "Rating must be between 1 and 5"
        }), 400

    created_at = datetime.now(
        timezone.utc
    ).isoformat(timespec="seconds")

    with get_db_connection() as connection:
        cursor = connection.execute("""
            INSERT INTO reviews (
                court_id,
                reviewer_name,
                rating,
                comment,
                created_at
            )
            VALUES (?, ?, ?, ?, ?)
        """, (
            court_id,
            name,
            rating,
            comment,
            created_at
        ))

        review_id = cursor.lastrowid
        connection.commit()

    summary = review_summary(court_id)

    return jsonify({
        "message": "Review submitted successfully",
        "review": {
            "id": review_id,
            "court_id": court_id,
            "reviewer_name": name,
            "rating": rating,
            "comment": comment,
            "created_at": created_at
        },
        "review_count": summary["review_count"],
        "average_rating": summary["average_rating"]
    }), 201


# ----------------------------
# START APPLICATION
# ----------------------------

initialize_database()

if __name__ == "__main__":
    app.run(debug=True)
