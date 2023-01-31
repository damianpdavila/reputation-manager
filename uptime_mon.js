/**
 * Client uptime monitoring component of One Hand Off application.  Runs independently as a standalone process
 * on the server and sends periodic "client site is up" emails to OHO support.
 * 
 * Per-client site URLs are passed in ./uptime-config.json
 * 
 * @fileOverview    Checks if client sites are up
 * @author          Damian Davila (Moventis, LLC)
 * @version         1.1
 */
var version_number = "1.1";

var fs = require('fs');
var configJson = __dirname + '/uptime-config.json';
var listConfig = require(configJson);

var appConfigJson = __dirname + '/app-config.json';
var appConfig = require(appConfigJson);

//  Server logging
var logFileBase = __dirname + '/logs/logFileUptime'
var logFile = logFileBase + '.0';
var maxLogVer = 6; // 0-based
var log = function(msg) {
    var d = new Date();
    console.log(d.toUTCString() + ' :: ' + msg);
    fs.appendFileSync(logFile, d.toUTCString() + ' :: ' + msg + '\n');
};

var Promise = require('bluebird');
var request = require("request");

var nodemailer = require('nodemailer');
var transporter = setupTransport(nodemailer);

rotateLogs();

var Xray = require('x-ray');
var xray = Xray({
    filters: {
        trim: function(value) {
            return typeof value === 'string' ? value.trim() : value
        },
        reverse: function(value) {
            return typeof value === 'string' ? value.split('').reverse().join('') : value
        },
        slice: function(value, start, end) {
            return typeof value === 'string' ? value.slice(start, end) : value
        },
        extractRating: function(value, ratingClass, start, end) {
            if (typeof(value) === 'string') {
                var strt = value.indexOf(ratingClass) + start;
                var endd = strt + end;
                return (value.slice(strt, endd));
            } else {
                return value;
            }
        }
    }
});


// var path = require('path');
// var childProcess = require('child_process');
// var phantomjs = require('phantomjs-prebuilt');
// var binPath = phantomjs.path;

// == Nightmare won't work on Webfaction (CentOS) servers, though works like charm on Windows :(
// var Nightmare = require('nightmare');

// ===============================
//  Process the target URLs
// ===============================
function mainLoop() {
    log("Starting mainLoop(); version: " + version_number);

    // === Cycle through monitored sites
    var fetchTitle;
    var goodMsg = "";
    var badMsg = "";
    var fetches = [];
    var uptimeEmail = "control@moventisusa.com";
    var sites = Object.keys(listConfig.client);
    sites.forEach(function(site) {
        fetches.push(fetchURL(listConfig.client[site].url, listConfig.client[site].clientName, listConfig.client[site].title));
    });
    Promise.each(fetches, function(fetchResult) {
        if (fetchResult.fetchedTitle) {
            goodMsg += fetchResult.name + " is up; title is " + fetchResult.fetchedTitle + "<br/>";
        } else {
            badMsg += fetchResult.name + " is NOT up or title does not match.<br/>";
        }
    }).then(function() {

        if (badMsg) {
            alertError(transporter, badMsg);
        } else {
            if (goodMsg) {
                sendNotificationEmail(transporter, uptimeEmail, goodMsg);
            }
        }
    });
    log("Ending mainLoop(); version: " + version_number);
};

mainLoop();

// ===============================  
//  Fetch the target URL and validate it's "upness"
// ===============================
function fetchURL(url, clientName, clientTitle) {
    return new Promise(function(resolve, reject) {
        xray(url, 'title')(function(err, title) {
            if (err) {
                log(err);
                resolve({ fetchedTitle: "", name: clientName });
            }
            if (title && title.trim() == clientTitle) {
                resolve({ fetchedTitle: title, name: clientName });
            } else {
                log("Title does not match");
                resolve({ fetchedTitle: "", name: clientName });
            }
        });
        //return title;
    });
};

// ===============================
//  Send notification email to client
// ===============================
function sendNotificationEmail(transporter, wpTargetEmail, msg) {

    // setup e-mail data with unicode symbols 
    var d = new Date();
    var wpEmailConfig = "<img style='max-width: 150px; height: auto;' src='https://onehandoff.com/wp-content/uploads/2017/03/One-Hand-Off-logo-vertical-2.png'>" +
        "<h2>Client Site Uptime Status</h2>" +
        "<p>" + msg + "</p>" +
        "<p>&copy; 2017 One Hand Off";

    var mailOptions = {
        from: "OHO Uptime Monitor <uptime@onehandoff.com>", // sender address **MUST be registered in Webfaction email system 
        to: wpTargetEmail,
        subject: "One Hand Off uptime monitoring status " + d.toString().substr(0, 15),
        html: wpEmailConfig // html body 
    };
    //log("mail options:", mailOptions); // TESTING

    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            return log(error);
        }
        log('Notification sent: ' + info.response);
        return 0;
    });
};

// =====================
//  Alert admin via email for any error conditions
// =====================
function alertError(transporter, errMessage) {

    // setup e-mail data with unicode symbols 
    var mailOptions = {
        from: 'OHO Uptime Monitor <uptime@onehandoff.com>', // sender address **MUST be registered in Webfaction email system 
        to: 'damiandavila@yahoo.com, control@onehandoff.com, 9544657537@txt.att.net', // list of receivers 
        subject: 'OHO uptime monitoring error encountered', // Subject line 
        text: 'Houston, we have a problem: ' + errMessage, // plaintext body 
        html: '<b>Houston we have a problem: </b>' + errMessage // html body 
    };

    // send mail with defined transport object 
    transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
            return log(error);
        }
        log('Alert error sent: ' + errMessage + ' Send status: ' + info.response);
        return;
    });
};

// ===============================
//  Set up email transport
// ===============================
function setupTransport(nodemailer) {

    // create reusable transporter object using the default SMTP transport 
    var smtpConfig = {
        host: appConfig.email.smtpHost,
        port: 465,
        secure: true, // use SSL 
        auth: {
            user: appConfig.email.smtpUserid,
            pass: appConfig.email.smtpPassword
        }
    };
    return nodemailer.createTransport(smtpConfig);
};

// ===============================
//  Do log file backups
// ===============================
function rotateLogs() {
    for (var i = maxLogVer; i > 0; i--) {
        try {
            var logFrom = logFileBase + '.' + (i - 1).toString();
            var logTo = logFileBase + '.' + i.toString();
            fs.renameSync(logFrom, logTo);
        } catch (error) {
            log(error);
        }
    };
    log('Rotated log files');
    return;
};