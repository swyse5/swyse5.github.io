// Function to populate a select element with golfer options
function populateGolferSelect(selectId, startRank, endRank) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Try to get full rankings data first, fall back to simple array if not available
    let rankings = [];
    const rankingsJson = localStorage.getItem('golferRankingsData');
    if (rankingsJson) {
        try {
            const data = JSON.parse(rankingsJson);
            // Handle both new format (with rankings array) and old format
            rankings = (data.rankings || data);
            // Filter rankings for the specified range
            rankings = rankings.filter(r => r.ranking >= startRank && r.ranking <= endRank);
        } catch (error) {
            console.error('Error parsing rankings JSON:', error);
        }
    } else {
        // Fallback to old format
        const simpleRankings = JSON.parse(localStorage.getItem('golferRankings') || '[]');
        rankings = simpleRankings.slice(startRank - 1, endRank).map((name, idx) => ({
            name,
            ranking: startRank + idx,
            fullName: name
        }));
    }
    
    // Clear existing options
    select.innerHTML = '<option value="">Choose a golfer...</option>';
    
    // Add golfer options for the specified rank range
    rankings.sort((a, b) => a.ranking - b.ranking).forEach(golfer => {
        var displayName = golfer.fullName || golfer.name;
        if (displayName) {
            const option = document.createElement('option');
            option.value = displayName;
            option.textContent = `${golfer.ranking}. ${displayName}`;
            select.appendChild(option);
        }
    });
}

// Initialize golfer selections
document.addEventListener('DOMContentLoaded', function() {
    // Initial population of select elements with expanded ranges
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