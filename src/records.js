const {Client} = require('espn-fantasy-football-api/node')
const myClient = new Client({leagueId:848574})

const SWID = 'AAC0A15B-F90D-46A3-A094-51F0E8BAA75A'
const espns2 = 'AEAkVY25pG8TVJPa%2B5gtl%2F%2BoM4OcfQe8F5mJsjU4gpbbE%2FdgbS8VkUBeizXVt0vQ72cT4GK6CVRwpdD0Zv9IbOTbDcpITXI6JTJs9rRy7U2x5mRnb14KJTJZafcitE6pMIuQIbwR6HEmzL%2B0pgQSUxaNNjxAJy5Ta4h5rFkJ9wdBs37trapLBJ9kQ3lO%2BKKGr2YjTXGzR%2Fy%2Fnnf4LXPJUGC%2BRuEvk0e8qWjLoaRS%2FcC0Mcuvxzw1xDYdfDRnin0VILomS5p01O7MRQLZkxtqxOPL8f1Bj2QxrFkP7C%2FbEYFSkQ%3D%3D'
myClient.setCookies({SWID, espns2})

