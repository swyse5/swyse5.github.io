console.log('League history script loaded');

$(document).ready(function() {
    console.log('League history document ready');
    
    function displayIframe() {
        const container = $('#league-history-content');
        
        if (!container.length) {
            console.error('Container not found!');
            return;
        }

        const iframeHtml = `
            <div class="sheet-container">
                <iframe 
                    src="https://docs.google.com/spreadsheets/d/e/2PACX-1vSALess6eaKke3QXEQ_ZHntcaeAgAwrR304VIXVEYfQ_V8yPDwMWJ5I-aarHWJiOb8FzUM0sKdnpb51/pubhtml?widget=true&headers=false" 
                    frameborder="0"
                    width="100%"
                    height="100%"
                    style="min-height: 800px;"
                ></iframe>
            </div>
        `;

        container.html(iframeHtml);
    }

    // Initialize tab handling
    $('#league-history-tab').on('shown.bs.tab', function (e) {
        console.log('League history tab shown');
        displayIframe();
    });

    // If league history tab is active, display immediately
    if ($('#league-history-tab').hasClass('active')) {
        console.log('League history tab is initially active');
        displayIframe();
    }
}); 