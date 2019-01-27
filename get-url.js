var request = require("request"),
  cheerio = require("cheerio"),
  // url = "http://www.wunderground.com/cgi-bin/findweather/getForecast?&query=" + 02888;
  // url = "https://query.yahooapis.com/v1/public/yql?q=select wind from weather.forecast where woeid in (select woeid from geo.places(1) where text='chicago, il')&format=json&callback=";
  url = "http://localhost:8080/api/v1.0/?dummy=dummy";
  
request(url, function (error, response, body) {
  if (!error) {
    // var $ = cheerio.load(body),
    //  temperature = $("[data-variable='temperature'] .wx-value").html();
      
    // console.log("It’s " + temperature + " degrees Fahrenheit.");
	var jsonWind = JSON.parse(body);
	var wind = jsonWind.query.results.channel.wind;
	console.log("The wind chill is " + wind.chill);
	console.dir(jsonWind);
  } else {
    console.log("We’ve encountered an error: " + error);
  }
});
