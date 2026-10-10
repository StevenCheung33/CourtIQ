
// Initialize the map
const map = L.map("map").setView([39.0458, -77.0730], 12);

// OpenStreetMap tiles
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Map layers
const courtLayer = L.layerGroup().addTo(map);

let locationMarker = null;
let radiusCircle = null;

// Fixed search radius (miles)
const SEARCH_RADIUS = 5;

// HTML elements
const resultsCount = document.getElementById("results-count");
const courtPanel = document.getElementById("court-panel");
const closePanelButton = document.getElementById("close-panel");

const courtName = document.getElementById("court-name");
const courtDistance = document.getElementById("court-distance");
const courtHoops = document.getElementById("court-hoops");
const courtLighting = document.getElementById("court-lighting");
const courtSurface = document.getElementById("court-surface");
const directionsLink = document.getElementById("directions-link");

// Calculate distance between coordinates in miles
function calculateDistance(lat1, lon1, lat2, lon2) {
    return map.distance(
        [lat1, lon1],
        [lat2, lon2]
    ) / 1609.344;
}

// Format unknown court properties
function formatValue(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "Unknown";
    }

    return String(value);
}

// Open the profile panel for a selected court
function openCourtProfile(court, distance) {
    courtName.textContent = formatValue(court.name);

    courtDistance.textContent =
        `${distance.toFixed(2)} miles from search location`;

    courtHoops.textContent = formatValue(court.hoops);

    const lighting = String(court.lit || "").toLowerCase();

    if (lighting === "yes") {
        courtLighting.textContent = "Yes";
    } else if (lighting === "no") {
        courtLighting.textContent = "No";
    } else {
        courtLighting.textContent = "Unknown";
    }

    courtSurface.textContent = formatValue(court.surface);

    // Google Maps directions using the court coordinates
    const latitude = Number(court.latitude);
    const longitude = Number(court.longitude);

    const destination = encodeURIComponent(
        `${latitude},${longitude}`
    );

    directionsLink.href =
        `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

    // Show the profile panel
    courtPanel.hidden = false;

    // Scroll the panel back to the top
    courtPanel.scrollTop = 0;
}

// Close the profile panel
function closeCourtProfile() {
    courtPanel.hidden = true;
}

closePanelButton.addEventListener("click", closeCourtProfile);

// Close the panel when Escape is pressed
document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
        closeCourtProfile();
    }
});

// Display courts as clickable markers
function displayCourts(courts, latitude, longitude) {
    courtLayer.clearLayers();

    let courtsFound = 0;

    courts.forEach(function(court) {
        const courtLatitude = Number(court.latitude);
        const courtLongitude = Number(court.longitude);

        if (
            !Number.isFinite(courtLatitude) ||
            !Number.isFinite(courtLongitude)
        ) {
            return;
        }

        const distance = calculateDistance(
            latitude,
            longitude,
            courtLatitude,
            courtLongitude
        );

        if (distance > SEARCH_RADIUS) {
            return;
        }

        courtsFound++;

        const marker = L.marker([
            courtLatitude,
            courtLongitude
        ]);

        // Open profile when marker is clicked
        marker.on("click", function() {
            openCourtProfile(court, distance);
        });

        marker.addTo(courtLayer);
    });

    resultsCount.textContent =
        `${courtsFound} basketball courts found nearby.`;
}

// Retrieve basketball courts from Flask
async function loadCourts(latitude, longitude) {
    resultsCount.textContent = "Searching for basketball courts...";

    closeCourtProfile();

    try {
        const url =
            `/api/courts?lat=${latitude}&lon=${longitude}&radius=${SEARCH_RADIUS}`;

        const response = await fetch(url);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not retrieve basketball courts."
            );
        }

        // Remove old search marker
        if (locationMarker) {
            map.removeLayer(locationMarker);
        }

        // Remove old search radius
        if (radiusCircle) {
            map.removeLayer(radiusCircle);
        }

        // Create search center marker
        locationMarker = L.marker([latitude, longitude])
            .addTo(map)
            .bindPopup("Search location");

        // Draw the search radius
        radiusCircle = L.circle([latitude, longitude], {
            radius: SEARCH_RADIUS * 1609.344,
            color: "#2563eb",
            fillOpacity: 0.05
        }).addTo(map);

        // Zoom to search area
        map.fitBounds(radiusCircle.getBounds());

        // Display basketball court markers
        displayCourts(data.courts, latitude, longitude);

    } catch (error) {
        console.error("Court search error:", error);

        resultsCount.textContent = error.message;
    }
}

// Search for a city or address
async function searchLocation() {
    const location = document
        .getElementById("location-search")
        .value.trim();

    if (!location) {
        alert("Please enter a city or address.");
        return;
    }

    resultsCount.textContent = "Finding location...";

    try {
        const url =
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Location search failed.");
        }

        const results = await response.json();

        if (results.length === 0) {
            throw new Error("Location not found.");
        }

        const latitude = Number(results[0].lat);
        const longitude = Number(results[0].lon);

        await loadCourts(latitude, longitude);

    } catch (error) {
        console.error("Location search error:", error);

        resultsCount.textContent = error.message;
    }
}

// Find courts near the user's current location
function useMyLocation() {
    if (!navigator.geolocation) {
        alert("Your browser does not support location services.");
        return;
    }

    resultsCount.textContent = "Waiting for location permission...";

    navigator.geolocation.getCurrentPosition(
        function(position) {
            loadCourts(
                position.coords.latitude,
                position.coords.longitude
            );
        },

        function(error) {
            if (error.code === 1) {
                resultsCount.textContent =
                    "Location permission denied. Please search manually.";
            } else {
                resultsCount.textContent =
                    "Unable to determine your location.";
            }
        },

        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}

// Search button
document.getElementById("search-button")
    .addEventListener("click", searchLocation);

// Use My Location button
document.getElementById("my-location-button")
    .addEventListener("click", useMyLocation);

// Enter key searches too
document.getElementById("location-search")
    .addEventListener("keydown", function(event) {
        if (event.key === "Enter") {
            searchLocation();
        }
    });
