var date = new Date();
var day = date.getDay();
console.log(day);
function getData(){
requirejs.config({
  paths: {
    jquery: 'jquery.min',
    espn: 'espn.min'
  }
});

requirejs([
  'jquery',
  'espn'
], function($, espnApi) {
  async function init() {
    const { Client } = espnApi;
    const client = new Client({ leagueId: 848574 });

    var weekOfYear = function(date){
      var d = new Date(+date);
      d.setHours(0,0,0);
      d.setDate(d.getDate()+4-(d.getDay()||7));
      return Math.ceil((((d-new Date(d.getFullYear(),0,1))/8.64e7)+6)/7);
    };
    var d = new Date();
    var year = d.getFullYear();
    var week = weekOfYear(Date.now()) - 37; // starts in sept
    const league = await client.getLeagueInfo({seasonId: year});
    var matchups = league.scheduleSettings.numberOfRegularSeasonMatchups;
    const teams = await client.getTeamsAtWeek({seasonId: year, scoringPeriodId: week});
    const boxscoreForWeek = await client.getBoxscoreForWeek({ seasonId: year, matchupPeriodId: week, scoringPeriodId: week});
    // players
    var players = [];
    for (var i = 0; i < boxscoreForWeek.length; i++) {
      var box = boxscoreForWeek[i];
      players.push(box.homeRoster);
      players.push(box.awayRoster);
    }
    var allPlayers = [].concat.apply([], players);
    var highestPlayer = allPlayers[0];
    var mvp = $('.stat--mvp');
    for (var i = 0; i < allPlayers.length; i++) {
      var player = allPlayers[i];
      if (player.position != "Bench") {
        if (player.totalPoints > highestPlayer.totalPoints) {
          highestPlayer = player;
        }
      }
    }
    if (highestPlayer.totalPoints != 0) {
      mvp.find('.name').text(highestPlayer.player.fullName);
      mvp.find('.owner').text(highestPlayer.player.proTeam);
      mvp.find('.wins').text(highestPlayer.player.defaultPosition);
      mvp.find('.score').text(Number(highestPlayer.totalPoints.toFixed(1)));
    }

    // stats
    var lowestTeamScore = Number.POSITIVE_INFINITY;
    var highestTeamScore = Number.NEGATIVE_INFINITY;
    var teamScore;
    var highestTeam = [];
    var lowestTeam = [];
    var statHigh = $('.stat--high');
    var statLow = $('.stat--low');
    var managerTeam = $('.el--manager').find('.team');

    for (var i = 0; i < teams.length; i++) {
      var team = teams[i];
      teamScore = team.totalPointsScored;
      if (teamScore < lowestTeamScore) {
        lowestTeamScore = Number(teamScore.toFixed(1));
        lowestTeam = {name: team.name, owner: team.abbreviation, percent: team.winningPercentage, score: lowestTeamScore};
      }
      if (teamScore > highestTeamScore) {
        highestTeamScore = Number(teamScore.toFixed(1));
        highestTeam = {name: team.name, owner: team.abbreviation, percent: team.winningPercentage, score: highestTeamScore};
      }
    }

    statHigh.find('.name').text(highestTeam.name);
    statHigh.find('.score').text(highestTeam.score);
    statHigh.find('.owner').text(highestTeam.owner);
    statHigh.find('.percent').text(highestTeam.percent);

    statLow.find('.name').text(lowestTeam.name);
    statLow.find('.score').text(lowestTeam.score);
    statLow.find('.owner').text(lowestTeam.owner);
    statLow.find('.percent').text(lowestTeam.percent);

    // manager team
    for (var i = 0; i < managerTeam.length; i++) {
      for (var a = 0; a < teams.length; a++) {
        var manNum = parseInt(managerTeam[i].attributes.value.value);
        var id = teams[a].id;
        if (manNum === id) {
          $(managerTeam[i]).text(teams[a].name);
        }
      }
    }

    // score header
    $('#season').text(year);
    $('#week').text(week);

    var elBoxscore = $('.boxscore');

    // boxscores
    for (var i = 0; i < boxscoreForWeek.length; i++) {
      var box = boxscoreForWeek[i];
      var home;
      var away;
      var leader;

      box.homeTeamId === 9 ? home = teams[box.homeTeamId - 2] : home = teams[box.homeTeamId - 1];
      box.awayTeamId === 9 ? away = teams[box.awayTeamId - 2] : away = teams[box.awayTeamId - 1];
      box.homeScore > box.awayScore ? leader = 'leader--home' : '';
      box.awayScore > box.homeScore ? leader = 'leader--away' : '';

      var homeArr = {name: home.name, score: box.homeScore, logo: home.logoURL, wins: home.wins, losses: home.losses, hw: home.homeWins, hl: home.homeLosses, seed: home.playoffSeed};
      var awayArr = {name: away.name, score: box.awayScore, logo: away.logoURL, wins: away.wins, losses: away.losses, aw: away.awayWins, al: away.awayLosses, seed: away.playoffSeed};

      var elBox = elBoxscore[i];
      var elHome = $(elBox).find('.home');
      var elAway = $(elBox).find('.away');

      elBox.classList.add(leader);

      elHome.find('.logo .img').attr('src', homeArr.logo);
      elHome.find('.name').text(homeArr.name);
      elHome.find('.record').text('('+homeArr.wins+'-'+homeArr.losses+', '+homeArr.hw+'-'+homeArr.hl+' home) Seed: '+homeArr.seed);
      elHome.find('.score').text(homeArr.score);

      elAway.find('.logo .img').attr('src', awayArr.logo);
      elAway.find('.name').text(awayArr.name);
      elAway.find('.record').text('('+awayArr.wins+'-'+awayArr.losses+', '+awayArr.aw+'-'+awayArr.al+' away) Seed: '+awayArr.seed);
      elAway.find('.score').text(awayArr.score);
    }
  }

  init();

});

setTimeout(getData, 30000);
}

getData();
