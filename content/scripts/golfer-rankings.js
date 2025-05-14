// TUGR rankings data (from https://tugr.org/api/rankings)
const TUGR_DATA = {
    "rankings": [
        {"fullName":"Scottie Scheffler","ranking":1,"tour":"PGA"},
        {"fullName":"Rory McIlroy","ranking":2,"tour":"PGA"},
        {"fullName":"Jon Rahm","ranking":3,"tour":"LIV"},
        {"fullName":"Bryson DeChambeau","ranking":4,"tour":"LIV"},
        {"fullName":"Collin Morikawa","ranking":5,"tour":"PGA"},
        {"fullName":"Xander Schauffele","ranking":6,"tour":"PGA"},
        {"fullName":"Joaquin Niemann","ranking":7,"tour":"LIV"},
        {"fullName":"Justin Thomas","ranking":8,"tour":"PGA"},
        {"fullName":"Patrick Cantlay","ranking":9,"tour":"PGA"},
        {"fullName":"Tommy Fleetwood","ranking":10,"tour":"PGA"},
        {"fullName":"Hideki Matsuyama","ranking":11,"tour":"PGA"},
        {"fullName":"Shane Lowry","ranking":12,"tour":"PGA"},
        {"fullName":"Russell Henley","ranking":13,"tour":"PGA"},
        {"fullName":"Tyrrell Hatton","ranking":14,"tour":"LIV"},
        {"fullName":"Sepp Straka","ranking":15,"tour":"PGA"},
        {"fullName":"Corey Conners","ranking":16,"tour":"PGA"},
        {"fullName":"Ludvig Aberg","ranking":17,"tour":"PGA"},
        {"fullName":"Lucas Herbert","ranking":18,"tour":"LIV"},
        {"fullName":"Aaron Rai","ranking":19,"tour":"PGA"},
        {"fullName":"Jason Day","ranking":20,"tour":"PGA"},
        {"fullName":"Luke Clanton","ranking":21,"tour":"PGA"},
        {"fullName":"Sungjae Im","ranking":22,"tour":"PGA"},
        {"fullName":"Keegan Bradley","ranking":23,"tour":"PGA"},
        {"fullName":"Sebastian Munoz","ranking":24,"tour":"LIV"},
        {"fullName":"Denny McCarthy","ranking":25,"tour":"PGA"},
        {"fullName":"Sam Burns","ranking":26,"tour":"PGA"},
        {"fullName":"Akshay Bhatia","ranking":27,"tour":"PGA"},
        {"fullName":"Cameron Smith","ranking":28,"tour":"LIV"},
        {"fullName":"Robert MacIntyre","ranking":29,"tour":"PGA"},
        {"fullName":"JJ Spaun","ranking":30,"tour":"PGA"},
        {"fullName":"Carlos Ortiz","ranking":31,"tour":"LIV"},
        {"fullName":"Tom Kim","ranking":32,"tour":"PGA"},
        {"fullName":"Tony Finau","ranking":33,"tour":"PGA"},
        {"fullName":"Jordan Spieth","ranking":34,"tour":"PGA"},
        {"fullName":"Viktor Hovland","ranking":35,"tour":"PGA"},
        {"fullName":"Brooks Koepka","ranking":36,"tour":"LIV"},
        {"fullName":"Matt Fitzpatrick","ranking":37,"tour":"PGA"},
        {"fullName":"Max Homa","ranking":38,"tour":"PGA"},
        {"fullName":"Brian Harman","ranking":39,"tour":"PGA"},
        {"fullName":"Wyndham Clark","ranking":40,"tour":"PGA"},
        {"fullName":"Dustin Johnson","ranking":41,"tour":"LIV"},
        {"fullName":"Patrick Reed","ranking":42,"tour":"LIV"},
        {"fullName":"Adam Scott","ranking":43,"tour":"LIV"},
        {"fullName":"Cameron Young","ranking":44,"tour":"PGA"},
        {"fullName":"Si Woo Kim","ranking":45,"tour":"PGA"},
        {"fullName":"Sahith Theegala","ranking":46,"tour":"PGA"},
        {"fullName":"Justin Rose","ranking":47,"tour":"PGA"},
        {"fullName":"Min Woo Lee","ranking":48,"tour":"PGA"},
        {"fullName":"Kurt Kitayama","ranking":49,"tour":"PGA"},
        {"fullName":"Harris English","ranking":50,"tour":"PGA"},
        {"fullName":"Chris Kirk","ranking":51,"tour":"PGA"},
        {"fullName":"Eric Cole","ranking":52,"tour":"PGA"},
        {"fullName":"Adam Hadwin","ranking":53,"tour":"PGA"},
        {"fullName":"Taylor Moore","ranking":54,"tour":"PGA"},
        {"fullName":"Nicolai Højgaard","ranking":55,"tour":"PGA"},
        {"fullName":"Matthieu Pavon","ranking":56,"tour":"PGA"},
        {"fullName":"Byeong Hun An","ranking":57,"tour":"PGA"},
        {"fullName":"Nick Taylor","ranking":58,"tour":"PGA"},
        {"fullName":"Keith Mitchell","ranking":59,"tour":"PGA"},
        {"fullName":"Emiliano Grillo","ranking":60,"tour":"PGA"},
        {"fullName":"Lucas Glover","ranking":61,"tour":"PGA"},
        {"fullName":"Adam Svensson","ranking":62,"tour":"PGA"},
        {"fullName":"Andrew Putnam","ranking":63,"tour":"PGA"},
        {"fullName":"Thomas Detry","ranking":64,"tour":"PGA"},
        {"fullName":"Alex Noren","ranking":65,"tour":"PGA"},
        {"fullName":"Taylor Montgomery","ranking":66,"tour":"PGA"},
        {"fullName":"Matt Wallace","ranking":67,"tour":"PGA"},
        {"fullName":"Brendon Todd","ranking":68,"tour":"PGA"},
        {"fullName":"Mackenzie Hughes","ranking":69,"tour":"PGA"},
        {"fullName":"Tom Hoge","ranking":70,"tour":"PGA"},
        {"fullName":"Gary Woodland","ranking":71,"tour":"PGA"},
        {"fullName":"Phil Mickelson","ranking":72,"tour":"LIV"},
        {"fullName":"Sergio Garcia","ranking":73,"tour":"LIV"},
        {"fullName":"Abraham Ancer","ranking":74,"tour":"LIV"},
        {"fullName":"Talor Gooch","ranking":75,"tour":"LIV"},
        {"fullName":"Harold Varner III","ranking":76,"tour":"LIV"},
        {"fullName":"Dean Burmester","ranking":77,"tour":"LIV"},
        {"fullName":"Charl Schwartzel","ranking":78,"tour":"LIV"},
        {"fullName":"Louis Oosthuizen","ranking":79,"tour":"LIV"},
        {"fullName":"Bubba Watson","ranking":80,"tour":"LIV"},
        {"fullName":"Seamus Power","ranking":81,"tour":"PGA"},
        {"fullName":"J.T. Poston","ranking":82,"tour":"PGA"},
        {"fullName":"Davis Riley","ranking":83,"tour":"PGA"},
        {"fullName":"Luke List","ranking":84,"tour":"PGA"},
        {"fullName":"Kevin Yu","ranking":85,"tour":"PGA"},
        {"fullName":"Vincent Norrman","ranking":86,"tour":"PGA"},
        {"fullName":"Ben Griffin","ranking":87,"tour":"PGA"},
        {"fullName":"Sam Ryder","ranking":88,"tour":"PGA"},
        {"fullName":"Stephan Jaeger","ranking":89,"tour":"PGA"},
        {"fullName":"Cam Davis","ranking":90,"tour":"PGA"},
        {"fullName":"Christiaan Bezuidenhout","ranking":91,"tour":"PGA"},
        {"fullName":"Matt Kuchar","ranking":92,"tour":"PGA"},
        {"fullName":"Alex Smalley","ranking":93,"tour":"PGA"},
        {"fullName":"Nick Hardy","ranking":94,"tour":"PGA"},
        {"fullName":"Beau Hossler","ranking":95,"tour":"PGA"},
        {"fullName":"Lee Hodges","ranking":96,"tour":"PGA"},
        {"fullName":"Patrick Rodgers","ranking":97,"tour":"PGA"},
        {"fullName":"Ben Martin","ranking":98,"tour":"PGA"},
        {"fullName":"Mark Hubbard","ranking":99,"tour":"PGA"},
        {"fullName":"Peter Malnati","ranking":100,"tour":"PGA"}
    ]
};

// Function to populate dropdown with golfers
function populateGolferDropdowns() {
    const dropdowns = [
        document.getElementById('golfer1'),
        document.getElementById('golfer2'),
        document.getElementById('golfer3'),
        document.getElementById('golfer4')
    ];

    const startRanks = [0, 10, 20, 30]; // Starting indices for each dropdown (0-based index)

    dropdowns.forEach((dropdown, index) => {
        // Clear existing options
        dropdown.innerHTML = '<option value="">Choose a golfer...</option>';
        
        // Get starting rank for this dropdown (add 1 for display)
        const startRank = startRanks[index];
        
        // Add golfers from startRank to end of list
        TUGR_DATA.rankings.slice(startRank).forEach((golfer) => {
            const option = document.createElement('option');
            option.value = golfer.fullName;
            option.textContent = `${golfer.fullName} (Rank: ${golfer.ranking})`;
            dropdown.appendChild(option);
        });
    });
}

// Initialize rankings when the page loads
document.addEventListener('DOMContentLoaded', function() {
    populateGolferDropdowns();
}); 