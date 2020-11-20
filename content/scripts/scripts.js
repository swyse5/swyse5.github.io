$(document).ready(function() {
  getCurrentInvetory();
});

function getCurrentInvetory() {
  var spreadsheetID = "19ICfLUYwFYwbpBCLxjYpXwkOmyjYBqWWdf6MtxV8fIk";
  var url = "https://spreadsheets.google.com/feeds/list/" + spreadsheetID + "/od6/public/values?alt=json";
  $.getJSON(url, function(data) {
    var entry = data.feed.entry;

    $(entry).each(function(index, element) {

      if (index === 0) {

        var plaque = $('<div class="el el--plaque">' +
                          '<div class="corner corner--tl"></div>' +
                          '<div class="corner corner--tr"></div>' +
                          '<div class="corner corner--bl"></div>' +
                          '<div class="corner corner--br"></div>' +
                          '<div class="plaque__text"></div>' +
                        '</div>'
                      ).appendTo('.club--champion');

        var pt = plaque.find('.plaque__text');

        pt.append(
          $(document.createElement('div')).text(this.gsx$year.$t).addClass('year')
        );
        pt.append(
          $(document.createElement('div')).text(this.gsx$teamname.$t).addClass('name')
        );
        pt.append(
          $(document.createElement('div')).text(this.gsx$manager.$t).addClass('manager')
        );

      } else {

        var plaque = $('<div class="el el--plaque">' +
                          '<div class="corner corner--tl"></div>' +
                          '<div class="corner corner--tr"></div>' +
                          '<div class="corner corner--bl"></div>' +
                          '<div class="corner corner--br"></div>' +
                          '<div class="plaque__text"></div>' +
                        '</div>'
                      ).appendTo('.club--past');

        var pt = plaque.find('.plaque__text');

        pt.append(
          $(document.createElement('div')).text(this.gsx$year.$t).addClass('year')
        );
        pt.append(
          $(document.createElement('div')).text(this.gsx$teamname.$t).addClass('name')
        );
        pt.append(
          $(document.createElement('div')).text(this.gsx$manager.$t).addClass('manager')
        );
      }
    });
  });
  // setTimeout(getCurrentInvetory, 300);
}
