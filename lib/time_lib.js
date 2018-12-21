/* jshint esnext: true */
var dateFormat = require('dateformat');
var tz = require('moment-timezone');

/**
 *  Returns current time in UTC format
 *
 */
module.exports.getCurrentUTC = function () {
  var now = new Date();
  dateFormat(now, "yyyy-mm-dd HH:MM:ss");
  
  var myutc = tz(now).utc().format();
  myutc = myutc.replace('T', ' ');
  myutc = myutc.replace('Z', '');

  return myutc;
}