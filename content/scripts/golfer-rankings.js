// Function to populate a select element with golfer options
async function populateGolferSelect(selectId, startRank, endRank) {
    const select = document.getElementById(selectId);
    if (!select) return;

    try {
        // Get rankings from JSON file
        const response = await fetch('/data/rankings.json?' + new Date().getTime());
        const data = await response.json();
        const rankings = data.rankings || [];

        // Filter rankings for the specified range
        const filteredRankings = rankings
            .filter(r => r.ranking >= startRank && r.ranking <= endRank)
            .sort((a, b) => a.ranking - b.ranking);

        // Clear existing options
        select.innerHTML = '<option value="">Choose a golfer...</option>';
        
        // Add golfer options
        filteredRankings.forEach(golfer => {
            const displayName = golfer.fullName || golfer.name;
            if (displayName) {
                const option = document.createElement('option');
                option.value = displayName;
                option.textContent = `${golfer.ranking}. ${displayName}`;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Error loading rankings:', error);
        select.innerHTML = '<option value="">Error loading golfers</option>';
    }
}

// Initialize golfer selections
document.addEventListener('DOMContentLoaded', function() {
    // Initial population of select elements
    populateGolferSelect('golfer1', 1, 100);
    populateGolferSelect('golfer2', 11, 100);
    populateGolferSelect('golfer3', 21, 100);
    populateGolferSelect('golfer4', 31, 100);

    // Set up periodic refresh of golfer lists
    setInterval(() => {
        populateGolferSelect('golfer1', 1, 100);
        populateGolferSelect('golfer2', 11, 100);
        populateGolferSelect('golfer3', 21, 100);
        populateGolferSelect('golfer4', 31, 100);
    }, 30000); // Check for updates every 30 seconds
}); 