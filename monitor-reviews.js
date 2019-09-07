/**
 * Review monitoring component of One Hand Off application.  Runs independently as a standalone process
 * on the server and sends any found reviews back to the client OHO site.  Also sends notification email
 * to client.
 * 
 * Per-client review sites and email addresses are passed in ./review-config.json
 * 
 * @fileOverview    Retrieves latest reviews from social and review sites
 * @author          Damian Davila (Moventis, LLC)
 * @version         1.5.4
 */
var version_number = "1.5.4";

var fs = require('fs');
var configJson = __dirname + '/review-config.json';
var configJsonBkup = __dirname + '/review-config-bkup.json';
var listConfig = require( configJson );

var appConfigJson = __dirname + '/app-config.json';
var appConfig = require( appConfigJson );

//  Server logging
var logFileBase = __dirname + '/logs/logFile' 
var logFile = logFileBase + '.0';
var maxLogVer = 6;  // 0-based
var log = function(msg) {
    try {
        var d = new Date();
        console.log(d.toUTCString() + ' :: ' + msg);
        fs.appendFileSync(logFile, d.toUTCString() + ' :: ' + msg + '\n');
    } catch (error) {
        alertError(transporter, "Error writing to log file. Error:" + error);
    }
};

var Promise = require('bluebird');
var request = require("request");

var nodemailer = require('nodemailer');
var transporter = setupTransport(nodemailer);
   
rotateLogs();

var Xray = require('x-ray');
var xray = Xray({
    filters: {
      trim: function (value) {
        return typeof value === 'string' ? value.trim() : value
      },
      reverse: function (value) {
        return typeof value === 'string' ? value.split('').reverse().join('') : value
      },
      slice: function (value, start , end) {
        return typeof value === 'string' ? value.slice(start, end) : value
      },
      extractRating: function (value, ratingClass, start, end) {
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

var GoogleLocations = require('google-locations');
var locations = new GoogleLocations(appConfig.google.locationsApiKey);

// 09072018: attempting to re-enable Nightmare as a potential solution has been found -- and PhantomJS no longer actively supported
//  var path = require('path');
//  var childProcess = require('child_process');
//  var phantomjs = require('phantomjs-prebuilt');
//  var binPath = phantomjs.path;

// == Nightmare won't work on Webfaction (CentOS) servers, though works like charm on Windows :(
// 09072018: attempting to re-enable as a potential solution has been found -- and PhantomJS no longer actively supported
// var Nightmare = require('nightmare');

/** 05182019:  Using Puppeteer browser automation instead of PhantomJS and Nightmare for scraping Facebook
 *  Both of those stopped working, probably due to Facebook changes.
 *  Puppeteer uses Chromium and seems to work (at least so far).
 */
const puppeteer = require('puppeteer');
let browser = null;
let pageFacebook = null;
let pageYelp = null;
let facebookLogin;
let facebookData;

function getBrowser(browserName) {
    return new Promise (function(resolve, reject) {
        if (browser == null) {
            log("Creating new Puppeteer browser: " + browserName );
            
            var puppeteerBrowser = puppeteer.launch({headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
            resolve(puppeteerBrowser);
        } else {
            log("Retrieved existing Puppeteer browser: " + browserName );
            resolve(browser);
        }
    })
}

var captureFBload = __dirname + '/facebook-load.png';
var captureFBlogin = __dirname + '/facebook-post-login.png';
var googleSearch = __dirname + '/google-search.html';

// Note: inline width declaration (w/o px) is required because of Win10 mail client; need to override with CSS for all other purposes
var logo = new Object();
logo['yelp'] =
        '<img width="45" src="https://onehandoff.com/wp-content/uploads/yelp-logo-transparent-sq-300x300.png" data-sizes="(max-width: 300px) 100vw, 300px" srcset="https://onehandoff.com/wp-content/uploads/yelp-logo-transparent-sq-300x300.png 300w, https://onehandoff.com/wp-content/uploads/yelp-logo-transparent-sq-550x400.png 550w, https://onehandoff.com/wp-content/uploads/yelp-logo-transparent-sq-230x230.png 230w, https://onehandoff.com/wp-content/uploads/yelp-logo-transparent-sq-300x300.png 700w" alt="Yelp logo" class="alignnone size-medium">';
logo['google'] = 
        '<img width="45" src="https://onehandoff.com/wp-content/uploads/g-icon_red-300x300.png" data-sizes="(max-width: 300px) 100vw, 300px" srcset="https://onehandoff.com/wp-content/uploads/g-icon_red-150x150.png 150w, https://onehandoff.com/wp-content/uploads/g-icon_red-300x300.png 300w, https://onehandoff.com/wp-content/uploads/g-icon_red-230x230.png 230w, https://onehandoff.com/wp-content/uploads/g-icon_red-300x300.png 512w" alt="Google+ logo" class="alignnone size-medium">';
logo['tripadvisor'] =
        '<img width="45" src="https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-sq-300x300.png" data-sizes="(max-width: 300px) 100vw, 300px" srcset="https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-sq-300x300.png 300w, https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-sq-1024x1024.png 1024w, https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-sq-830x830.png 830w, https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-550x358.png 550w, https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-sq-230x230.png 230w, https://onehandoff.com/wp-content/uploads/tripadvisor-logo-vert-transparent-sq-300x300.png 1200w" alt="TripAdvisor logo" class="alignnone size-medium">';
logo['facebook'] = 
        '<img width="45" src="https://onehandoff.com/wp-content/uploads/FB-f-Logo__blue_512-300x300.png" data-sizes="(max-width: 300px) 100vw, 300px" srcset="https://onehandoff.com/wp-content/uploads/FB-f-Logo__blue_512-150x150.png 150w, https://onehandoff.com/wp-content/uploads/FB-f-Logo__blue_512-300x300.png 300w, https://onehandoff.com/wp-content/uploads/FB-f-Logo__blue_512-230x230.png 230w, https://onehandoff.com/wp-content/uploads/FB-f-Logo__blue_512-300x300.png 512w" alt="Facebook logo" class="alignnone size-medium">';
logo['zomato'] = 
        '<img width="45" src="https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-300x300.png" data-sizes="(max-width: 300px) 100vw, 300px" srcset="https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-150x150.png 150w, https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-300x300.png 300w, https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-830x830.png 830w, https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-550x550.png 550w, https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-230x230.png 230w, https://onehandoff.com/wp-content/uploads/zomato-logo-device-transparent-300x300.png 960w" alt="Zomato logo" class="alignnone size-medium">';

var uptimeEmail = "control@moventisusa.com";

// ===============================
//  Start processing in recurring chunks
// ===============================

// 06112018 on cold start, find last client processed rather than default to client 0; better approach and helps avoid some of the duplicate reviews.
//          Clients processed sequentially so lastDateProcessed should be ascending; when not, that's the last processed.
var lastClientProcessed = -1;
const end = listConfig.client.length - 1;  // since comparison is forward-looking, need to stop one short
for (var idx = 0; idx < end; idx++){
    if ( listConfig.client[idx].lastDateProcessed > listConfig.client[idx+1].lastDateProcessed ) {
        lastClientProcessed = idx;
        break;
    }
}

var interval = 0;
var msPerDay = 24*60*60*1000;  // milliseconds in a day
var lastProcessDate = new Date();

function mainLoop() {
    log("Starting mainLoop(), running version: " + version_number + "; lastClientProcessed is: " + lastClientProcessed);
    sendRunningEmail( transporter, uptimeEmail, "Starting mainLoop(), running version: " + version_number + "; lastClientProcessed is: " + lastClientProcessed );

	// === Get next client index
	var thisClient = ++lastClientProcessed;
	var lastClient = listConfig.client.length - 1;
	if (thisClient > lastClient) {
        // if processed all clients, back to first client
        thisClient = 0;
        // re-read the config file to pick up any changes (so don't require a restart to make changes)
        try {
            listConfig = JSON.parse(fs.readFileSync(configJson));
            log("Re-read config file")
        } catch (error) {
            alertError(transporter, "Error: Main() Failed to re-read config file, error: " + error)
        };
        // and rotate the log files
        rotateLogs();
	};
	log("thisClient: " + thisClient + " lastClient: " + lastClient);
    
    // === Process the current client
        
    monitorReviews(listConfig, thisClient)
        .then( function(clientProcessed){
            // === Save the last review date processed per client back into config json
            lastClientProcessed = clientProcessed;
            lastProcessDate = new Date();
            listConfig.client[clientProcessed].lastDateProcessed = lastProcessDate;
            fs.renameSync(configJson, configJsonBkup);
            fs.writeFileSync(configJson, JSON.stringify(listConfig, null, 2));
            return true;
        })
        .catch ( function(error) {
            fs.renameSync(configJsonBkup, configJson);
            alertError (transporter, "Error: Main() updating config file. Msg: " + error );
        })
        .then( function(){
            // set interval such that clients are processed in equal timeslots over 24 hours (to avoid getting blacklisted by review sites)
            interval = msPerDay / listConfig.client.length;
            var restartTime = new Date(lastProcessDate.getTime() + interval);
            log("Ending mainLoop(); total clients: " + listConfig.client.length + ", current time: " + lastProcessDate + " interval (minutes): " + interval/1000/60 + ", restart time: " + restartTime );
            setTimeout( mainLoop, interval );
        });
    return true;
};

getBrowser('Common')
    .then( function(theResult) {
        browser = theResult;
        mainLoop();
    });

log("Exited mainLoop()");

// ===============================  
//  Process client config's
// ===============================

function monitorReviews (clientConfig, clientIndex) {
// new
    return new Promise(function(resolve, reject){    
//        
        // === Cycle through client review sites
        var reviewURL, reviewSite, reviewClientName, reviewClientAddress = '';
        var reviews = [];
        var sites = Object.keys(clientConfig.client[clientIndex].reviewSites);
        // ensure stored date is valid format; necessary for new client setups
        // note that stored date is UTC timezone
        try {
            var afterThisDate = new Date(clientConfig.client[clientIndex].lastDateProcessed);
        }
        catch (e) {
            // problem with date so reset to a valid value
            afterThisDate = new Date();
        }
        // NOTE: the .setHours() function also converts date/time to local timezone 
        afterThisDate.setHours(0,0,0,0);
        sites.forEach( function(site) {
            reviewSite = clientConfig.client[clientIndex].reviewSites[site].siteTitle;
            reviewURL = clientConfig.client[clientIndex].reviewSites[site].url;
            reviewClientName = clientConfig.client[clientIndex].reviewSites[site].name;
            reviewClientAddress = clientConfig.client[clientIndex].reviewSites[site].address;
            log("Client name: " + reviewClientName + ", inner url: " + reviewURL); // TESTING
            // === Retrieve site reviews
            var fetchCall = fetchReviews(reviewSite, reviewURL, afterThisDate, reviewClientName, reviewClientAddress, clientConfig, clientIndex);
            reviews.push( fetchCall );        
        }); 
        // 06202016: Publish review post per site individually instead of all sites combined as before
        // wait for all reviews to be fetched  
        //Promise.all(reviews)
            // the resolved Promises return an array "reviewArray" of objects {'rvwSitetitle': '', 'rvwCount': 0, 'rvwText': ''}, one per review site
            /* 
            .then( function(reviewArray) {
                if ( reviewArray.some(function(element, index, ary) { return element.rvwCount > 0 }) ) {
                    // === Send review alert if any site returned a valid review (review count > 0 from any site)
                    var concatReviews = '<h4>' + clientConfig.client[clientIndex].clientName + '</h4>';
                    reviewArray.forEach(function(element, index, arr) {
                        concatReviews += element.rvwText;
                    });
                    sendReviews( transporter, clientConfig.client[clientIndex].clientWpEmail, concatReviews);                           
                } else {
                    log("No reviews found for any site. Client: " + clientConfig.client[clientIndex].clientName ); //TESTING
                }
            })
            */
            // 06202016: process review sites individually rather than concatenating
            /* 06112018: modify to ensure all processing including emails is done before ending loop and updating the process date. */
                        
        /* Promise.each(reviews, function(reviewSitedata) {
                if ( reviewSitedata.rvwCount > 0 ) {
                    // === Send review alert if site returned at least one valid review (review count > 0)
                    reviewSitedata.rvwText = '<h4>' + clientConfig.client[clientIndex].clientName + '</h4>' + reviewSitedata.rvwText;
                    sendReviews( transporter, clientConfig.client[clientIndex].clientWpEmail, reviewSitedata.rvwText, reviewSitedata.rvwSitetitle);
                    sendNotificationEmail( transporter, clientConfig.client[clientIndex].clientNotifEmail, reviewSitedata.rvwSitetitle, clientConfig.client[clientIndex].clientUrlName, reviewSitedata.rvwText );                           
                }
            })
        */
// new
        Promise.all(reviews)
            .then( function() {
                return resolve(clientIndex);
            })
            .catch( function(e) {
                alertError(transporter, "monitorReviews() Promise.all.catch " + e);
            });
// new            
//        return clientIndex;
        });
}; 

// ===============================  
//  Retrieve reviews from given URL
// ===============================
function fetchReviews( siteName, url, afterDate, bizName, bizAddress, clientConfig, clientIndex ){
    return new Promise(function(resolve, reject){

        // Return value from this function that is passed in the returned Promise object: 
        // rvwCount is valid reviews found on the current site; rvwText is concatenated and formatted text from found reviews
        var objReviewsPerSite = {'rvwSitetitle': '', 'rvwCount': 0, 'rvwText': ''};
        
        // Get all reviews from requested site
        if (siteName == 'yelp') {
            fetchYelpReviews(url)
                .then(function(reviewData){
                    return (formatReviewData(url, siteName, afterDate, reviewData));
                })
                .then(function(formattedReviews){
                    return (processReviews( formattedReviews, clientConfig, clientIndex ));
                })
                .then( function() {
                    return resolve(true);
                })
                .catch(TypeError, function(err){
                    // handle new Yelp page format #2
                    return fetchReviews("yelp2", url, afterDate, bizName, bizAddress, clientConfig, clientIndex);
                })
                .then( function() {
                    return resolve(true);
                })
                .catch(function(err){
                    alertError(transporter, "Error: fetchReviews() .catch, site:" + siteName + "error:" + err);
                    objReviewsPerSite.rvwSitetitle = siteName;
                    return resolve(objReviewsPerSite);
                });
        } 
        if (siteName == 'yelp2') {
            fetchYelpReviewsFormat2(url)
                .then(function(reviewData){
                    // set site name back so remaining logic works BAU
                    return (formatReviewData(url, 'yelp', afterDate, reviewData));
                })
                .then(function(formattedReviews){
                    return (processReviews( formattedReviews, clientConfig, clientIndex ));
                })
                .then( function() {
                    return resolve(true);
                })
                .catch(function(err){
                    alertError(transporter, "Error: fetchReviews() .catch, site:" + siteName + "error:" + err);
                    objReviewsPerSite.rvwSitetitle = siteName;
                    return resolve(objReviewsPerSite);
                });
        } 
        if (siteName == 'tripadvisor') {
            fetchTripadvisorReviews(url)
                .then(function(reviewData){
                    return (formatReviewData(url, siteName, afterDate, reviewData));
                })
                .then(function(formattedReviews){
                    return (processReviews( formattedReviews, clientConfig, clientIndex ));
                })
                .then( function() {
                    return resolve(true);
                })
                .catch(function(err){
                    alertError(transporter, "Error: fetchReviews() .catch, site:" + siteName + "error:" + err);
                    objReviewsPerSite.rvwSitetitle = siteName;
                    return resolve(objReviewsPerSite);
                });
        }
        if (siteName == 'facebook') {
            fetchFacebookReviews(url)
                .then(function(reviewData){
                    return (formatReviewData(url, siteName, afterDate, reviewData));
                })
                .then(function(formattedReviews){
                    return (processReviews( formattedReviews, clientConfig, clientIndex ));
                })
                .then( function() {
                    return resolve(true);
                })
                .catch(function(err){
                    alertError(transporter, "Error: fetchReviews() .catch, site:" + siteName + "error:" + err);
                    objReviewsPerSite.rvwSitetitle = siteName;
                    return resolve(objReviewsPerSite);
                });
        }
        if (siteName == 'google') {
            fetchGoogleReviews(url, bizName, bizAddress)
                .then(function(reviewData){
                    return (fetchGoogleReviewCount(url, siteName, reviewData));
                })
                .then(function(reviewData){
                    return (formatReviewData(url, siteName, afterDate, reviewData));
                })
                .then(function(formattedReviews){
                    return (processReviews( formattedReviews, clientConfig, clientIndex ));
                })
                .then( function() {
                    return resolve(true);
                })
                .catch(function(err){
                    alertError(transporter, "Error: fetchReviews() .catch, site:" + siteName + "error:" + err);
                    objReviewsPerSite.rvwSitetitle = siteName;
                    return resolve(objReviewsPerSite);
                });
        }
        /*
        else {
            alertError (transporter, "Client config error; review site name not valid. Site: " + siteName + " url: " + url + " Name: " + bizName);
            objReviewsPerSite.rvwSitetitle = siteName;
            objReviewsPerSite.rvwCount = 0;
            objReviewsPerSite.rvwText = "";
            resolve(objReviewsPerSite);
        } 
        */                              
    });
};
// ===============================  
//  Retrieve reviews from given URL
// ===============================
function processReviews( reviewSitedata, clientConfig, clientIndex ){
    return new Promise(function(resolve, reject){
        var reviewText = "";
        var reviewsSend = [];

        if ( reviewSitedata.rvwCount > 0 ) {
            // === Send review data in reverse chronological so reviews stack up in proper order in client WP database
            reviewSitedata.rvwArray.reverse().forEach(function(review){
                reviewText = '<h4>' + clientConfig.client[clientIndex].clientName + '</h4>' + review;
                let sendArg = {'tp': transporter, 'email': clientConfig.client[clientIndex].clientWpEmail, 'rvwText': reviewText, 'title': reviewSitedata.rvwSitetitle};
                reviewsSend.push(  new Promise(function(resolve) {
                    resolve(sendArg);
                }));
            });
            Promise.each(reviewsSend, function(item, idx, len){
                sendReviews( item.tp, item.email, item.rvwText, item.title);
                // === When find more than one review, must slow the email send rate or they are not guaranteed to post in date order in the WP database (jetpack post by email issue)
                return new Promise(function(resolve, reject){
                    setTimeout(function(){
                        resolve();
                    }, 5000);
                });
            })
            .then(function(){
                reviewText = reviewSitedata.rvwArray.join(' ');
                resolve( sendNotificationEmail( transporter, clientConfig.client[clientIndex].clientNotifEmail, reviewSitedata.rvwSitetitle, clientConfig.client[clientIndex].clientUrlName, reviewText ));
            })
            .catch(function(err){
                alertError(transporter, "Error processReviews() catch on send review or alert" + err);
                resolve(true);
            });
        } else {
            resolve(true);
        }
    });
};
// ===============================  
//  Scrape the reviews
// ===============================
function fetchYelpReviews(url) {
    return new Promise(function(resolve, reject){
        xray(url, {
            bizRating: 'div.biz-rating-very-large div.i-stars.rating-very-large@title',
            reviewCount: 'div.biz-rating-very-large span.review-count',
            reviews: xray('div.review.review--with-sidebar', [{
                rating: xray('div.review-content', 'div.i-stars.rating-large@title'),
                date: xray('div.review-content', 'span.rating-qualifier'),
                description: xray('div.review-content', 'p'),
                author: xray('div.review-sidebar-content', 'a.user-display-name')
            }])
        })(function(err, reviewData) {
            if (err) {
                log(err);
                alertError (transporter, "Error: fetchYelpReviews(). Msg: " + err );
            }

            try {                
                //log("resolve fetchYelpReviews, reviewData=" + reviewData); //TESTING
                // Standardize the summary rating literals
                var summaryRating = reviewData.bizRating.split(" ", 1);
                reviewData.bizRating = summaryRating[0] + ' of 5 stars';
                // Yelp review date is in ISO format so forces UTC timezone when string is converted to a Date object later.
                // Adding time literal forces the Date object to correct back to original date locally, which makes user display easier later.
                // Also need to convert from MM/DD/YYYY
                reviewData.reviews.forEach(function (element, index, arr) {
                    // Parse the date parts to integers
                    var parts = element.date.trim().split("/");
                    var day = parts[1].length > 1 ? parts[1] : "0" + parts[1] ;
                    var month = parts[0].length > 1 ? parts[0] : "0" + parts[0] ;
                    var year = parts[2].trim().slice(0,4);
                    element.date = year + '-' + month + '-' + day  + 'T05:00:00.000';
                });
                resolve(reviewData);
            } catch (error) {
                // Usually errors are due to scraping unexpected page format or partial page.
                // Log error but set up to retry the alternative format scrape.
                //alertError (transporter, "Error: fetchYelpReviews(). Uncaught exception: " + error );
                log("Warning: fetchYelpReviews() error. Will now retry with format 2. Msg: " + error);
                reviewData = {bizRating: "", reviewCount: "", reviews: []};
                reject(new TypeError());
            }

        });
    });
};
function fetchYelpReviewsFormat2(url) {
    return new Promise(function(resolve, reject){
        // Load Yelp review page, ensure the page elements are loaded, capture the html

        (async function () {

            var browserYelp = browser;

            if (pageYelp == null) {
                pageYelp = await browserYelp.newPage();
                log("YELP:  Created new Puppeteer page");
            }
        
            await pageYelp.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3419.0 Safari/537.36');
            await pageYelp.setViewport({width: 1280, height: 2000});
        
            await pageYelp.goto(url);
        
            // Ensure all the review data has loaded; reviewer data tends to load last so check for that.
            await pageYelp.waitForSelector('li.u-space-b3:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)');

            var yelpData = await pageYelp.evaluate(function(){
                var reviewData = {RC: 0, rvwData: {bizRating: "", reviewCount: "", reviews: []}};
            

                reviewData.rvwData.bizRating = document.querySelector('div.lemon--div__373c0__1mboc.i-stars__373c0__30xVZ').getAttribute("aria-label");
                reviewData.rvwData.reviewCount = document.querySelector('div.gutter-6__373c0__zqA5A:nth-child(2) > div:nth-child(2) > p:nth-child(1)').textContent;
                
                var divs = document.querySelectorAll('ul.lemon--ul__373c0__1_cxs:nth-child(4) li.u-space-b3');

                if (divs.length == 0) {
                    reviewData.RC = 2;
                    reviewData.rvwData = "";
                    return reviewData;
                }
                for (var i = 0; i < divs.length; i++) {
                    var a_review = {};
                    divs[i].querySelector('div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > a:nth-child(1) > span:nth-child(1)')
                        == null ? a_review.author = 'n/a' : a_review.author = divs[i].querySelector('div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > a:nth-child(1) > span:nth-child(1)').textContent;
                    
                    divs[i].querySelector('div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > span:nth-child(1)') 
                        == null ? a_review.date = '' : a_review.date = divs[i].querySelector('div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > span:nth-child(1)').textContent;
    
                    if (divs[i].querySelector('div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > span:nth-child(1) > div:nth-child(1)') != null) {
                        // rating
                        a_review.rating = divs[i].querySelector('div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > span:nth-child(1) > div:nth-child(1)').getAttribute("aria-label");
                    } 
                    else {
                        // error
                        a_review.rating = 'n/a';
                    }
                    var ps = divs[i].querySelectorAll('div:nth-child(1) > div:nth-child(2) > div:nth-child(2) > p:nth-child(1) > span:nth-child(1)');
                    a_review.description = '';
                    for (var j = 0; j < ps.length; j++) {
                        a_review.description += ps[j].textContent;    
                    }                        
                    reviewData.rvwData.reviews.push(a_review);
                }
    
                return reviewData;

            });
            return yelpData;
                    
        })().then(reviews => {
            if (reviews.RC > 0 ) {
                log('Error: Scraping Yelp reviews failed. RC:' + reviews.RC); 
                alertError(transporter, 'Error: Scraping Yelp reviews failed. RC:' + reviews.RC);
            }
            //log("resolve fetchYelpReviews, reviewData=" + rvwData); //TESTING
            try {                
                //log("resolve fetchYelpReviews, reviewData=" + reviewData); //TESTING
                // Standardize the summary rating literals
                var summaryRating = reviews.rvwData.bizRating.split(" ", 1);
                reviews.rvwData.bizRating = summaryRating[0] + ' of 5 stars';
                // Yelp review date is in ISO format so forces UTC timezone when string is converted to a Date object later.
                // Adding time literal forces the Date object to correct back to original date locally, which makes user display easier later.
                // Also need to convert from MM/DD/YYYY
                reviews.rvwData.reviews.forEach(function (element, index, arr) {
                    // Parse the date parts to integers
                    var parts = element.date.trim().split("/");
                    var day = parts[1].length > 1 ? parts[1] : "0" + parts[1] ;
                    var month = parts[0].length > 1 ? parts[0] : "0" + parts[0] ;
                    var year = parts[2].trim().slice(0,4);
                    element.date = year + '-' + month + '-' + day  + 'T05:00:00.000';
                });
                resolve(reviews.rvwData);
            } catch (error) {
                alertError (transporter, "Error: fetchYelpReviewsFormat2(). Uncaught exception: " + error );
                resolve({bizRating: "", reviewCount: "", reviews: []});
            }
        })      
        .catch(error => {
            if (error instanceof puppeteer.errors.TimeoutError) {
                log('Puppeteer timeout error: ' + error.name + ' Details: ' + error.message);
                alertError(transporter, 'Puppeteer Yelp timeout error: ' + error.name + ' Details: ' + error.message);
                resolve({bizRating: "", reviewCount: "", reviews: []});
            } else {
                log('Puppeteer error: ' + error.name + ' Details: ' + error.message);
                alertError(transporter, 'Puppeteer Yelp error: ' + error.name + ' Details: ' + error.message);
                resolve({bizRating: "", reviewCount: "", reviews: []});
            } 
        });
    });
};
function fetchTripadvisorReviews(url) {
    return new Promise(function(resolve, reject){
        xray(url, {
            bizRating: 'span.ui_bubble_rating@alt',
            reviewCount: 'div.rs.rating a.more',
            reviews: xray('.review-container .prw_reviews_basic_review_hsx', [{
                rating: 'div.rating.reviewItemInline span.ui_bubble_rating@class',
                date: 'div.rating.reviewItemInline span.ratingDate.relativeDate@title',
                dateVerbose: 'div.rating.reviewItemInline span.ratingDate',
                title: 'div.quote span.noQuotes',
                description: 'div.entry p.partial_entry',
                author: 'div.username.mo span'
            }])
        })(function(err, reviewData) {
            if (err) {
                log(err);
                alertError (transporter, "Error: fetchTripAdvisorReviews(). Msg: " + err );
            }
            try {
                //log("resolve fetchTripadvisorReviews, reviewData=" + reviewData); //TESTING
                // 12-17-2017: now only way to get rating is to parse the class name
                // Rating is bubble_NN class where numeric rating is NN, e.g. 30=3.0, but only need single digit
                var strt = 0, endd = 0;
                for (var index in reviewData.reviews) {
                    strt = reviewData.reviews[index].rating.indexOf(' bubble_');
                    if (strt < 0) {
                        reviewData.reviews[index].rating = 'N/A';
                        log('fetchTripadvisorReviews: scraping error');
                        alertError(transporter, 'Error: fetchTripadvisorReviews: scraping error')
                        break;
                    } else {
                        strt += 8;
                        endd = strt + 1;
                        reviewData.reviews[index].rating = reviewData.reviews[index].rating.slice(strt, endd) + ' of 5 stars';    
                    }
                }              
            } catch (error) {
                alertError (transporter, "Error: fetchTripAdvisorReviews(). Uncaught exception: " + error );
                reviewData = {bizRating: "", reviewCount: "", reviews: []};
            }
            resolve(reviewData);
        });
    });
};
function fetchGoogleReviews(url, bizName, bizAddress) {
    return new Promise(function(resolve, reject){
        //log("Starting fetchGoogleReviews for ", bizName); // TESTING
        locations.searchByAddress({address: bizAddress, name: bizName, maxResults: 1, rankby: "distance", radius: 5000}, function(err, response){
            //log("Returned fetchGoogleReviews for ", bizName); // TESTING
            var reviewData = {bizRating: "", reviewCount: "", reviews: []};
            try {
                
                for (var index in response.details) {
                    reviewData.bizRating = response.details[index].result.rating.toString() + ' of 5 stars';
                    // 5-26-2016: Google removed this property from the Places API; no replacement avail easily so omit for now
                    // official: https://code.google.com/p/gmaps-api-issues/issues/detail?id=3484#makechanges
                    // found in: https://stackoverflow.com/questions/37419487/user-ratings-total-no-longer-available-in-google-places-api-alternative-for-get
                    // reviewData.reviewCount = response.details[index].result.user_ratings_total.toString();
                    reviewData.reviewCount = "n/a";
                    for (var idx in response.details[index].result.reviews){
                        var a_review = {};
                        a_review.author = response.details[index].result.reviews[idx].author_name;
                        a_review.rating = response.details[index].result.reviews[idx].rating.toString() + ' of 5 stars';
                        a_review.date = response.details[index].result.reviews[idx].time * 1000;
                        a_review.description = response.details[index].result.reviews[idx].text;                                            
                        reviewData.reviews.push(a_review);
                    }
                }
                for (var index in response.errors) {
                    log("Error looking up place details: ", JSON.stringify(response.errors[index]));
                    alertError (transporter, "Error: fetchGoogleReviews(). Msg: " + JSON.stringify(response.errors[index]));
                    reviewData = {bizRating: "", reviewCount: "", reviews: []};
                }
            } catch (error) {
                log("Error looking up place details: Uncaught exception: ", error);
                alertError (transporter, "Error: fetchGoogleReviews(). Msg: Uncaught exception: " + error);
                reviewData = {bizRating: "", reviewCount: "", reviews: []};
            }
            //log("resolve fetchGoogleReviews, reviewData=" + reviewData); //TESTING
            resolve(reviewData);
        });        
    });
};
function fetchGoogleReviewCount(url, bizName, reviewData) {
    return new Promise(function(resolve, reject){
        //log("Starting fetchGoogleReviewCount for ", bizName); // TESTING
        resolve(reviewData);
        
        // Scraping Google review count fails in x-ray and PhantomJS. It works in Nightmare, but Nightmare won't work on Webfaction servers
        // due to electron prebuilt executable.
        // So... we'll just dummy out and wait for Google to re-enable review count in their API.
                     
    });
};
function fetchFacebookReviews(url) {

    return new Promise(function(resolve, reject){
        /** Load Facebook review page, bypass login if necessary, click to sort by most recent, capture the html */
    
        (async function () {

            /** Try to minimize Facebook logins by keeping one browser open as long as possible.
             *  Hopefully reduce risk of Facebook locking out the ID or forcing other hurdles as in the past.
             */
            var browserFacebook = browser;


            if (pageFacebook == null) {
                pageFacebook = await browserFacebook.newPage();
                log("FACEBOOK:  Created new Puppeteer page");
            }
        
            await pageFacebook.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3419.0 Safari/537.36');
            await pageFacebook.setViewport({width: 1280, height: 2000});
        
            await pageFacebook.goto(url);
            // Check for login
            facebookLogin = null;
            facebookLogin = await pageFacebook.$('form#login_form input#email');
        
            if (facebookLogin != null) {
                
                await pageFacebook.waitForSelector('form#login_form input#email');
                await pageFacebook.type('form#login_form input#email', 'ohoapp@onehandoff.com');
                await pageFacebook.waitForSelector('form#login_form input#pass');
                await pageFacebook.type('form#login_form input#pass', 'd03p29d64oho');
                await pageFacebook.click('#login_form input[type="submit"]');
                await pageFacebook.waitForNavigation();
                await pageFacebook.goto(url);
                log("FACEBOOK:  Logged into Facebook");            
            }
        
            await pageFacebook.waitForSelector('a>span>div');
        
            await Promise.all([
                //pageFacebook.waitForNavigation(),   // The promise resolves after navigation has finished
                pageFacebook.evaluate(function(){   // Clicking the link will indirectly cause a navigation
                    var divs = document.querySelectorAll('a>span>div');
                    for (var i = 0; i < divs.length; i++) {
                        var index = divs[i].innerHTML.indexOf('MOST RECENT');
                        if (index != -1) {
                            divs[i].click();
                            break;
                        }
                    }
                    return divs[i].outerHTML;                  
                })
            ]);
            await pageFacebook.waitForSelector('#recommendations_tab_main_feed div.userContentWrapper');
            facebookData = await pageFacebook.evaluate(function(){
                var reviewData = {RC: 0, rvwData: {bizRating: "", reviewCount: "", reviews: []}};
            
                reviewData.rvwData.bizRating = document.querySelector('div._672g').textContent + ' of 5 stars';
                // Pull the review count out of the string: 'Based on the opinion of NN,NNN people'
                reviewData.rvwData.reviewCount = document.querySelector('span._67l2').textContent;
                var rexp = /(\d+(\,\d*)*)/i;
                var str = document.querySelector('span._67l2').textContent;
                if (str == null) {
                    reviewData.rvwData.reviewCount = "";
                } else {
                    reviewData.rvwData.reviewCount = str.match(rexp)[0];
                }
                
                // Validate that reviews are sorted into "most recent" order
                if (document.querySelector('li a[aria-selected="true"] span > div').textContent.trim() == 'MOST RECENT') {
                    
                    var divs = document.querySelectorAll('#recommendations_tab_main_feed div.userContentWrapper');
                    if (divs.length == 0) {
                        reviewData.RC = 2;
                        reviewData.rvwData = "";
                        return reviewData;
                    }
                    for (var i = 0; i < divs.length; i++) {
                        var a_review = {};
                        divs[i].querySelector('span.fcg span.fwb .profileLink') == null ? a_review.author = 'n/a' : a_review.author = divs[i].querySelector('span.fcg span.fwb .profileLink').textContent;
                        divs[i].querySelector('span span a abbr[data-utime]') == null ? a_review.date = '' : a_review.date = parseInt(divs[i].querySelector('span span a abbr[data-utime]').getAttribute('data-utime'), 10) * 1000;  
        
                        // determine if review is a numerical star rating or a yes/no recommendation
        
                        // NOTE: the recomm/not recomm logic is currently based on literal:  "recommends", "recommended", "doesn't Recommend"; crappy but no other reliable way
                        
                        if (divs[i].querySelector('span.fcg > span.fwb + i') != null) {
                            if (divs[i].querySelector('span.fcg > span.fwb + i').nextSibling.textContent.indexOf('does') == -1) {
                                // recommended
                                a_review.rating = '6';
                            } else {
                                // not recommended
                                a_review.rating = '0';
                            }
                        } 
                        else if (divs[i].querySelector('a+i>u') != null) {
                            // rating
                            a_review.rating = divs[i].querySelector('a+i>u').textContent;
                        } 
                        else {
                            // error
                            a_review.rating = 'n/a';
                        }
                        var ps = divs[i].querySelectorAll('div.userContent p');
                        a_review.description = '';
                        for (var j = 0; j < ps.length; j++) {
                            a_review.description += ps[j].textContent;    
                        }                        
                        reviewData.rvwData.reviews.push(a_review);
                    }
        
                    return reviewData;
                } else {
                    alertError (transporter, "Error: fetchFacebookReviews(). Not in most recent order");
                    return {RC: 1, rvwData: {bizRating: "", reviewCount: "", reviews: []}};
                }
            });
            return facebookData;
            
        })().then(reviews => {
            if (reviews.RC > 0 ) {
                log('Error: Scraping reviews failed. RC:' + reviews.RC); 
                alertError(transporter, 'Error: Scraping reviews failed. RC:' + reviews.RC);
            }
            //log("resolve fetchFacebookReviews, reviewData=" + rvwData); //TESTING
            resolve(reviews.rvwData);
        })      
        .catch(error => {
            log('Puppeteer error: ' + error.name + ' Details: ' + error.message);
            alertError(transporter, 'Puppeteer Facebook error: ' + error.name + ' Details: ' + error.message);
            resolve({bizRating: "", reviewCount: "", reviews: []});
        });
    });
    
};
// ===============================
//  Format the review data for send to client site
// ===============================
function formatReviewData (url, siteName, afterDate, reviewData) {

    let txtReviews = [];
    let txtReview = "";
    var reviewCnt = 0;

    // Push any new reviews into array of formatted reviews
    if (reviewData.reviews.length == 0) {
        txtReviews.push("<p class='review-heading'>" + siteName.toUpperCase() + " data is not available at the moment.</p>");
    } else {
        // tripadvisor embeds the 'Reviews' literal with the review count so need to strip out.
        var idx = reviewData.reviewCount.toLowerCase().indexOf('review'); 
        if ( idx !== -1) {
            reviewData.reviewCount = reviewData.reviewCount.substr(0, idx-1 ).trim(); 
        }                        
        var reviewDate = '';  
        var reviewTitle = '';
        var ratingNum = 0;
        var rexp_rating = /(\d+\.*\d*)/i
        var keyIdx = Object.keys(reviewData.reviews);

        keyIdx.forEach(function(review){

            try {
                if (reviewData.reviews[review].hasOwnProperty('date')) {
                    reviewDate = new Date(reviewData.reviews[review].date);
                } else {
                    reviewDate = new Date(parseTripadvisorDateVerbose(reviewData.reviews[review].dateVerbose));
                }  
                if (isNaN(reviewDate))  {throw 'Invalid date';}
            }
            catch (e) {
                txtReview = '<p class="review-heading">There was a problem retrieving reviews. Invalid date format found.</p>';
                // problem with date so reset to a value which will skip remaining review processing
                reviewDate = new Date('1/1/1900');
            }                  
            
            // Only want new reviews since last run (or since client signup)
            if (reviewDate >= afterDate) {

                txtReview = '<h5>' + logo[siteName.toLowerCase()]
                + " Overall rating: " + reviewData.bizRating + " [" + reviewData.reviewCount + " reviews]</h5>";
                // + siteName.toUpperCase() 

                if (reviewData.reviews[review].hasOwnProperty('title')) {
                    reviewTitle = "<p>" + reviewData.reviews[review].title + "</p>";
                } else {
                    reviewTitle = '';
                }
                // 08132018: mod to handle new Facebook recommend/not recommends ratings system; no longer 5 point
                //ratingNum = reviewData.reviews[review].rating.substr(0, reviewData.reviews[review].rating.indexOf(" "))*1;  // *1 to force convert to number
                ratingNum = Number(reviewData.reviews[review].rating.match(rexp_rating)[0]);
                
                txtReview += "<h6>"
                            + "<a href='" + url + "' target='_blank'>"                              
                            //+ siteName + " : " 
                            + "(" + ((ratingNum / 5) * 100) + "%) "
                            + reviewDate.toDateString() + " " 
                            + "&#10070;" + " "
                            + reviewData.reviews[review].author + " "
                            + "</a>"
                            + "</h6>"
                            + reviewTitle
                            + "<p>" + reviewData.reviews[review].description + "</p>";
                reviewCnt++;     
                txtReviews.push(txtReview);
            } else {
                log("review date: " + reviewDate.toDateString() + ", after date: " + afterDate.toDateString() ); //TESTING
            }
        });
        if (reviewCnt == 0){
            txtReview += "<p>" + "No new " + siteName + " reviews today.</p>";
        }    
    }
    return {'rvwSitetitle': siteName, 'rvwCount': reviewCnt, 'rvwArray': txtReviews};
};

// ===============================
// ===============================
function parseTripadvisorDateVerbose (dateVerbose) {

    var months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var idx = 0;
    
    for (var i=0; ; i++) {
        if (i > 12) {
            // the scraped date did not include a valid month so is unexpected; just return the original string
            log('Error encountered parsing dateVerbose.');
            throw new Error('Error encountered parsing dateVerbose.');
            return dateVerbose;
            break;            
        }
        idx = dateVerbose.toLowerCase().indexOf(months[i]); 
        if ( idx !== -1) {
           return dateVerbose.substr(idx).trim();
           break; 
        }
    };
};
 
// ===============================
//  Send review to client WP installation
// ===============================
function sendReviews (transporter, wpTargetEmail, reviewTexts, siteName) {
    return new Promise(function(resolve, reject){

        // setup e-mail data with unicode symbols 
        var d = new Date();
        var wpEmailConfig = "<p>[category review-" + siteName.toLowerCase() + "][publicize off]</p><p>[end]</p>";
        var wpEmailConfigTxt = "\n[category review-" + siteName.toLowerCase() + "][publicize off]\n\n[end]";

        var mailOptions = {
            from: "Review Monitor <monitor@revoo.biz>", // sender address **MUST be registered in Webfaction email system 
            to: wpTargetEmail, 
            subject: "New " + siteName.toUpperCase() + " reviews " + d.toString().substr(0,15), 
            text: reviewTexts.replace(/<br>/gi, '\n') + "\n " + wpEmailConfigTxt, // plaintext body 
            html: reviewTexts + wpEmailConfig // html body 
        };
        // log("Send review content:" + reviewTexts.slice(0,200)); // TESTING
        transporter.sendMail(mailOptions, function(error, info){
            if(error){
                resolve( log("Error sendReviews()" + error) );
            } else {
                log("Sent content: " + mailOptions.html); // TESTING
                log('Reviews sent: ' + info.response);
                resolve(true );
            }
        });
    });
        
};

// ===============================
//  Send notification email to client
// ===============================
function sendNotificationEmail (transporter, wpTargetEmail, siteName, urlName, reviewContent) {
    
    // Setup e-mail data with unicode symbols 

    var wpEmailStyles = "<style>" + 
    " \
    div.oho h3 { \
        padding: 1em; \
        border: 1px lightgrey solid; \
        margin: 3em 10%; \
        background-color: aliceblue; \
    } \
    div.oho h4 { \
        font-size: 17px; \
        margin-top: 1em; \
        font-weight: 500; \
    } \
    div.oho h5 { \
        font-size: 15px; \
        margin: 2em 0 1em 0; \
    } \
    div.oho h5 span { \
        display: inline-block; \
        padding: 1em 0 0 0; /* vertically aligning the h5 text against the h5 img */ \
        font-weight: 500; \
    } \
    div.oho h6 { \
        font-size: 15px; \
        margin: 1em 0; \
        font-weight: 500; \
        clear: both; \
    } \
    div.oho p { \
        font-size: 15px; \
        line-height: 1.5em; \
    } \
    div.oho h5 img { \
        max-width: 25%; \
        max-height: 3em; \
        margin: 0em 0.5em 1em 0em; /* do not use negative values because gmail will omit entire margin declaration */ \
        float: left; \
    } \
    div.oho h6 img { \
        max-height: 1em; \
        margin: 0 0.75em 0 0.1em; \
    } \
    div.oho span.fb-rec { \
        text-decoration: none; \
        color: rgb(214, 80, 80); \
    } \
    div.oho #ft { \
        border-top: 1px lightgrey solid; \
        font-size: small; \
        color: grey; \
        margin-top: 4em; \
    }" +        
    "</style>";
    //
    // Note that inline width or height in <IMG> tags are necessary for Win10 email client. Use number w/o "px" or "nn%". Override in CSS for all other mail clients.
    //
    var wpEmailHead = "<html><head>" +
                        wpEmailStyles +
                        "</head><body><div class='oho'>" +
                        "<img width='25%' style='width: 25%; max-width: 150px; height: auto;' src='https://onehandoff.com/wp-content/uploads/2017/03/One-Hand-Off-logo-vertical-2.png'>" +
                        "<h2>New reviews found on " + siteName.toLowerCase().charAt(0).toUpperCase() + siteName.toLowerCase().substr(1) + "</h2>";
    var wpEmailFoot =   "<h3>Please log in to One Hand Off to manage your reviews. <a href='" + "https://onehandoff.com/" + urlName + "/wp-admin'>Click here to go to your dashboard.</a></h3>" +
                        "<p> </p>" +
                        "<p>&copy; 2018 One Hand Off</p>" +
                        "<p>One Hand Off<br>18331 Pines Blvd #121<br>Pembroke Pines, FL 33029</p>" +
                        "<div id='ft'><p><em>Important</em></p>" +
                        "<p>You received this message because you are enrolled for the One Hand Off Review Monitoring service.</p>" + 
                        "<p>You may terminate your membership at any time by visiting your dashboard. <a href='" + "https://onehandoff.com/" + urlName + "/wp-admin'>Click here to go to your dashboard.</a></p>" +
                        "</div></div></body></html>";
    var wpEmailHeadTxt = "\nNew reviews found on " + siteName.toLowerCase().charAt(0).toUpperCase() + siteName.toLowerCase().substr(1) +
                        "\n";
    var wpEmailFootTxt = "\nPlease log in to One Hand Off to view your reviews: https://onehandoff.com/" + urlName + "/wp-admin" +
                         "\n" + 
                         "\nOne Hand Off\n18331 Pines Blvd #121\nPembroke Pines, FL 33029" +
                         "\nImportant" +
                         "\nYou received this message because you are enrolled for the One Hand Off Review Monitoring service." + 
                         "\nYou may terminate your membership at any time by visiting your dashboard: https://onehandoff.com/" + urlName + "/wp-admin/" +
                          "\nCopyright 2018 One Hand Off";
    // convert review rating from % to numeric string using 5 point scale
    // 08132018: mod to handle new Facebook recommend/not recommends ratings system; no longer 5 point
    function convertPctNumber(matchString, pct, matchOffset, wholeString) {
        if (isNaN(pct)) {
            return 'n/a';
        }
        var pctNum = Number(pct);
        var retStr = "";
        if (pctNum == 0) {
            retStr = "<img height='16' style='height: 1em; width: auto;' src='https://onehandoff.com/wp-content/uploads/not-recommend.png'><span class='fb-rec'>Not Rec</span>";
        } else if (pctNum > 100) {
            retStr = "<img height='16' style='height: 1em; width: auto;' src='https://onehandoff.com/wp-content/uploads/recommend.png'><span class='fb-rec'>Recom</span>";
        }
        else {
            // force single decimal; for display purposes; also inline height declaration (w/o px) necessary because of Win10 mail client
            retStr = (Number(pctNum)/100*5).toFixed(1) + "<img height='15' style='height: 1em; width: auto;' src='https://onehandoff.com/wp-content/uploads/rating-star.png'>";
        }
        return retStr;
    }
    var wpEmailConfig = wpEmailHead + reviewContent.replace(/\(\s?\s?(\d*)\s?\%\s?\s?\)/gi, convertPctNumber) + wpEmailFoot;                                
    var wpEmailConfigTxt = wpEmailHeadTxt + wpEmailFootTxt;

    var d = new Date();    
    var mailOptions = {
        from: "Review Monitor <monitor@revoo.biz>", // sender address **MUST be registered in Webfaction email system 
        to: wpTargetEmail, 
        subject: "One Hand Off: New " + siteName.toUpperCase() + " reviews found " + d.toString().substr(0,15), 
        text: wpEmailConfigTxt, // plaintext body 
        html: wpEmailConfig // html body 
    };
    //log("mail options:", mailOptions); // TESTING

    transporter.sendMail(mailOptions, function(error, info){
        if(error){
            return log(error);
        }
        log('Notification sent: ' + info.response);
        return 0;
    });
};
    
// =====================
//  Alert admin via email for any error conditions
// =====================
function alertError (transporter, errMessage) {
   
  // setup e-mail data with unicode symbols 
  var mailOptions = {
  	from: 'Review Monitor <monitor@revoo.biz>', // sender address **MUST be registered in Webfaction email system 
      to: 'damiandavila@yahoo.com, control@onehandoff.com, 9544657537@txt.att.net', // list of receivers 
      subject: 'Revoo.biz monitoring error encountered', // Subject line 
      text: 'Houston, we have a problem: ' + errMessage, // plaintext body 
      html: '<b>Houston we have a problem: </b>' + errMessage // html body 
  };
   
  // send mail with defined transport object 
  transporter.sendMail(mailOptions, function(error, info){
      if(error){
          return log(error);
      }
      log('Alert error sent: ' + errMessage + ' Send status: ' + info.response);
  });
};

// ===============================
//  Set up email transport
// ===============================
function setupTransport (nodemailer) {

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
function rotateLogs () {
    for(var i = maxLogVer; i > 0; i--) {
        try {
            var logFrom = logFileBase + '.' + (i-1).toString();
            var logTo = logFileBase + '.' + i.toString();
            fs.renameSync(logFrom, logTo);          
        } catch (error) {
            log(error);      
        }          
    };
    log('Rotated log files');
    return;            
}; 
// ===============================
//  Send "running now" email
// ===============================
function sendRunningEmail (transporter, wpTargetEmail, msg) {
    
    // setup e-mail data with unicode symbols 
    var d = new Date();
    var wpEmailConfig = "<img style='max-width: 150px; height: auto;' src='https://onehandoff.com/wp-content/uploads/2017/03/One-Hand-Off-logo-vertical-2.png'>" +
                          "<h2>Reputation Mon Starting...</h2>" +
                          "<p>" + msg + "</p>" +
                          "<hr>" +
                          "<p>&copy; 2017 One Hand Off";
  
    var mailOptions = {
        from: "OHO Reputation Monitor <repmon@onehandoff.com>", // sender address **MUST be registered in Webfaction email system 
        to: wpTargetEmail, 
        subject: "One Hand Off Reputation Mon starting " + d.toString().substr(0,15), 
        html: wpEmailConfig // html body 
    };
      //log("mail options:", mailOptions); // TESTING
  
    transporter.sendMail(mailOptions, function(error, info){
        if(error){
            return log(error);
        }
        log('Start email sent: ' + info.response);
        return 0;
    });
};
  
