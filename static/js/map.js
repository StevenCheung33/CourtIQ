
// ----------------------------
// MAP SETUP
// ----------------------------

const map = L.map("map").setView(
    [39.0458, -77.0730],
    12
);

L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors"
    }
).addTo(map);

const courtLayer = L.layerGroup().addTo(map);

const SEARCH_RADIUS = 5;

let locationMarker = null;
let radiusCircle = null;
let selectedCourt = null;
let selectedCourtVersion = 0;
let searchVersion = 0;


// ----------------------------
// HTML ELEMENTS
// ----------------------------

const resultsCount = document.getElementById(
    "results-count"
);

const courtPanel = document.getElementById(
    "court-panel"
);

const closePanelButton = document.getElementById(
    "close-panel"
);

const courtName = document.getElementById(
    "court-name"
);

const courtDistance = document.getElementById(
    "court-distance"
);

const courtHoops = document.getElementById(
    "court-hoops"
);

const courtLighting = document.getElementById(
    "court-lighting"
);

const courtSurface = document.getElementById(
    "court-surface"
);

const directionsLink = document.getElementById(
    "directions-link"
);

const averageStars = document.getElementById(
    "average-stars"
);

const averageRating = document.getElementById(
    "average-rating"
);

const reviewCount = document.getElementById(
    "review-count"
);

const reviewsList = document.getElementById(
    "reviews-list"
);

const reviewForm = document.getElementById(
    "review-form"
);

const reviewerName = document.getElementById(
    "reviewer-name"
);

const reviewRating = document.getElementById(
    "review-rating"
);

const reviewComment = document.getElementById(
    "review-comment"
);

const submitReviewButton = document.getElementById(
    "submit-review"
);

const reviewMessage = document.getElementById(
    "review-message"
);


// ----------------------------
// HELPER FUNCTIONS
// ----------------------------

function calculateDistance(lat1, lon1, lat2, lon2) {
    return map.distance(
        [lat1, lon1],
        [lat2, lon2]
    ) / 1609.344;
}


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


function createStars(rating) {
    const roundedRating = Math.round(rating);

    return (
        "★".repeat(roundedRating) +
        "☆".repeat(5 - roundedRating)
    );
}


function formatDate(dateString) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return "Unknown date";
    }

    return date.toLocaleDateString(
        undefined,
        {
            year: "numeric",
            month: "short",
            day: "numeric"
        }
    );
}


function showReviewMessage(message, isError = false) {
    reviewMessage.textContent = message;

    reviewMessage.style.color = isError
        ? "#dc2626"
        : "#15803d";
}


function makeTextElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    element.textContent = text;

    return element;
}


// ----------------------------
// COURT PROFILE
// ----------------------------

async function openCourtProfile(court, distance) {
    selectedCourt = court;
    selectedCourtVersion++;

    const currentVersion = selectedCourtVersion;

    courtName.textContent = formatValue(court.name);

    courtDistance.textContent =
        `${distance.toFixed(2)} miles from search location`;

    courtHoops.textContent = formatValue(
        court.hoops
    );

    const lighting = String(
        court.lit || ""
    ).toLowerCase();

    if (lighting === "yes") {
        courtLighting.textContent = "Yes";
    } else if (lighting === "no") {
        courtLighting.textContent = "No";
    } else {
        courtLighting.textContent = "Unknown";
    }

    courtSurface.textContent = formatValue(
        court.surface
    );

    const latitude = Number(court.latitude);
    const longitude = Number(court.longitude);

    const destination = encodeURIComponent(
        `${latitude},${longitude}`
    );

    directionsLink.href =
        `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

    // Reset the review interface for this court.
    reviewForm.reset();
    reviewMessage.textContent = "";

    averageStars.textContent = "☆☆☆☆☆";
    averageRating.textContent = "Loading...";
    reviewCount.textContent = "";

    reviewsList.replaceChildren(
        makeTextElement(
            "p",
            "loading-message",
            "Loading reviews..."
        )
    );

    courtPanel.hidden = false;
    courtPanel.scrollTop = 0;

    await loadReviews(court.id, currentVersion);
}


function closeCourtProfile() {
    selectedCourt = null;
    selectedCourtVersion++;
    courtPanel.hidden = true;
}


closePanelButton.addEventListener(
    "click",
    closeCourtProfile
);


document.addEventListener(
    "keydown",
    function(event) {
        if (event.key === "Escape") {
            closeCourtProfile();
        }
    }
);


// ----------------------------
// LOAD COURT REVIEWS
// ----------------------------

async function loadReviews(courtId, version) {
    try {
        const url =
            `/api/courts/${encodeURIComponent(courtId)}/reviews`;

        const response = await fetch(url);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Unable to load reviews."
            );
        }

        // Ignore an old request if another court was selected.
        if (
            !selectedCourt ||
            selectedCourt.id !== courtId ||
            version !== selectedCourtVersion
        ) {
            return;
        }

        displayReviews(data);

    } catch (error) {
        console.error("Review loading error:", error);

        if (
            selectedCourt &&
            selectedCourt.id === courtId &&
            version === selectedCourtVersion
        ) {
            averageRating.textContent =
                "Ratings unavailable";

            reviewCount.textContent = "";

            reviewsList.replaceChildren(
                makeTextElement(
                    "p",
                    "loading-message",
                    "Could not load reviews."
                )
            );
        }
    }
}


// ----------------------------
// DISPLAY COURT REVIEWS
// ----------------------------

function displayReviews(data) {
    const count = data.review_count || 0;
    const average = data.average_rating;

    reviewCount.textContent =
        `${count} ${count === 1 ? "review" : "reviews"}`;

    if (count > 0 && average !== null) {
        averageRating.textContent =
            `${Number(average).toFixed(1)} / 5`;

        averageStars.textContent = createStars(
            Number(average)
        );
    } else {
        averageRating.textContent = "Not rated yet";
        averageStars.textContent = "☆☆☆☆☆";
    }

    reviewsList.replaceChildren();

    if (!data.reviews || data.reviews.length === 0) {
        const empty = document.createElement("div");
        empty.className = "reviews-placeholder";

        empty.appendChild(
            makeTextElement(
                "div",
                "empty-stars",
                "☆☆☆☆☆"
            )
        );

        empty.appendChild(
            makeTextElement(
                "strong",
                "",
                "No reviews yet"
            )
        );

        empty.appendChild(
            makeTextElement(
                "p",
                "",
                "Be the first to review this basketball court!"
            )
        );

        reviewsList.appendChild(empty);
        return;
    }

    data.reviews.forEach(function(review) {
        const card = document.createElement("div");
        card.className = "review-card";

        const header = document.createElement("div");
        header.className = "review-card-header";

        const name = makeTextElement(
            "strong",
            "review-author",
            review.reviewer_name
        );

        const stars = makeTextElement(
            "span",
            "review-stars",
            createStars(review.rating)
        );

        header.appendChild(name);
        header.appendChild(stars);

        const date = makeTextElement(
            "small",
            "review-date",
            formatDate(review.created_at)
        );

        const comment = makeTextElement(
            "p",
            "review-comment",
            review.comment
        );

        card.appendChild(header);
        card.appendChild(date);
        card.appendChild(comment);

        reviewsList.appendChild(card);
    });
}


// ----------------------------
// SUBMIT REVIEW
// ----------------------------

reviewForm.addEventListener(
    "submit",
    async function(event) {
        event.preventDefault();

        if (!selectedCourt) {
            showReviewMessage(
                "Please select a court first.",
                true
            );
            return;
        }

        const courtId = selectedCourt.id;
        const currentVersion = selectedCourtVersion;

        const name = reviewerName.value.trim();
        const rating = Number(reviewRating.value);
        const comment = reviewComment.value.trim();

        if (!name || !comment) {
            showReviewMessage(
                "Please fill out every field.",
                true
            );
            return;
        }

        if (
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5
        ) {
            showReviewMessage(
                "Please select a rating from 1 to 5.",
                true
            );
            return;
        }

        submitReviewButton.disabled = true;
        submitReviewButton.textContent = "Submitting...";

        showReviewMessage("");

        try {
            const url =
                `/api/courts/${encodeURIComponent(courtId)}/reviews`;

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: name,
                    rating: rating,
                    comment: comment
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not submit review."
                );
            }

            // Only update the panel if it's still the same court.
            if (
                selectedCourt &&
                selectedCourt.id === courtId &&
                currentVersion === selectedCourtVersion
            ) {
                reviewForm.reset();

                showReviewMessage(
                    "Review submitted successfully!"
                );

                await loadReviews(
                    courtId,
                    currentVersion
                );
            }

        } catch (error) {
            console.error(
                "Review submission error:",
                error
            );

            if (
                selectedCourt &&
                selectedCourt.id === courtId &&
                currentVersion === selectedCourtVersion
            ) {
                showReviewMessage(
                    error.message,
                    true
                );
            }

        } finally {
            submitReviewButton.disabled = false;
            submitReviewButton.textContent = "Submit Review";
        }
    }
);


// ----------------------------
// DISPLAY COURT MARKERS
// ----------------------------

function displayCourts(courts, latitude, longitude) {
    courtLayer.clearLayers();

    let courtsFound = 0;

    courts.forEach(function(court) {
        const courtLatitude = Number(
            court.latitude
        );

        const courtLongitude = Number(
            court.longitude
        );

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

        marker.on("click", function() {
            openCourtProfile(court, distance);
        });

        marker.addTo(courtLayer);
    });

    return courtsFound;
}


// ----------------------------
// LOAD BASKETBALL COURTS
// ----------------------------

async function loadCourts(latitude, longitude) {
    const currentSearch = ++searchVersion;

    resultsCount.textContent =
        "Searching for basketball courts...";

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

        if (currentSearch !== searchVersion) {
            return;
        }

        if (locationMarker) {
            map.removeLayer(locationMarker);
        }

        if (radiusCircle) {
            map.removeLayer(radiusCircle);
        }

        locationMarker = L.marker([
            latitude,
            longitude
        ])
            .addTo(map)
            .bindPopup("Search location");

        radiusCircle = L.circle(
            [latitude, longitude],
            {
                radius: SEARCH_RADIUS * 1609.344,
                color: "#2563eb",
                fillOpacity: 0.05
            }
        ).addTo(map);

        map.fitBounds(radiusCircle.getBounds());

        const courtsFound = displayCourts(
            data.courts || [],
            latitude,
            longitude
        );

        let message =
            `${courtsFound} basketball courts found nearby.`;

        if (data.source === "local") {
            message +=
                " Showing saved local court data because the live service is unavailable.";
        }

        resultsCount.textContent = message;

    } catch (error) {
        console.error(
            "Court search error:",
            error
        );

        if (currentSearch === searchVersion) {
            resultsCount.textContent = error.message;
        }
    }
}


// ----------------------------
// SEARCH CITY OR ADDRESS
// ----------------------------

async function searchLocation() {
    const location = document
        .getElementById("location-search")
        .value.trim();

    if (!location) {
        alert("Please enter a city or address.");
        return;
    }

    const currentSearch = ++searchVersion;

    resultsCount.textContent = "Finding location...";

    try {
        const url =
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Location search failed.");
        }

        const results = await response.json();

        if (currentSearch !== searchVersion) {
            return;
        }

        if (results.length === 0) {
            throw new Error("Location not found.");
        }

        const latitude = Number(results[0].lat);
        const longitude = Number(results[0].lon);

        await loadCourts(latitude, longitude);

    } catch (error) {
        console.error(
            "Location search error:",
            error
        );

        if (currentSearch === searchVersion) {
            resultsCount.textContent = error.message;
        }
    }
}


// ----------------------------
// USE MY LOCATION
// ----------------------------

function useMyLocation() {
    if (!navigator.geolocation) {
        alert(
            "Your browser does not support location services."
        );
        return;
    }

    const currentSearch = ++searchVersion;

    resultsCount.textContent =
        "Waiting for location permission...";

    navigator.geolocation.getCurrentPosition(
        function(position) {
            if (currentSearch !== searchVersion) {
                return;
            }

            loadCourts(
                position.coords.latitude,
                position.coords.longitude
            );
        },

        function(error) {
            if (currentSearch !== searchVersion) {
                return;
            }

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


// ----------------------------
// BUTTON EVENTS
// ----------------------------

document.getElementById("search-button")
    .addEventListener(
        "click",
        searchLocation
    );

document.getElementById("my-location-button")
    .addEventListener(
        "click",
        useMyLocation
    );

document.getElementById("location-search")
    .addEventListener(
        "keydown",
        function(event) {
            if (event.key === "Enter") {
                searchLocation();
            }
        }
    );
