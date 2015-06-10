'use strict';

var request = require('request'),
    redis = require('redis'),
    urlModule = require('url'),
    debug = require('debug')('SCXMLD-stateless-simulation-provider');


if (process.env.REDIS_URL) {
  var rtg = urlModule.parse(process.env.REDIS_URL);

  var redisPublish = redis.createClient(rtg.port, rtg.hostname);
  if(rtg.auth) redisPublish.auth(rtg.auth.split(':')[1]);

} else {
  redisPublish = redis.createClient();
}

var timeoutMap = {};
function sendEventToSelf(serverSendOptions, event) {
  
  if(serverSendOptions.cookies && Object.keys(serverSendOptions.cookies).length > 0) {
    //Extra support for ExpressJs and request cookies
    var jar = request.jar();

    Object.keys(serverSendOptions.cookies).forEach(function (cookieName) {
      jar.setCookie(request.cookie(cookieName + '=' + serverSendOptions.cookies[cookieName]), serverSendOptions.uri);
    });

    delete serverSendOptions.cookies;

    serverSendOptions.jar = jar;
  }

  serverSendOptions.json = event;

  debug('sending event to self', serverSendOptions);

  request(serverSendOptions, function(error, response, body){
    //debug('response',err,response.statusCode,body);
    if(error) console.error('error sending event to server', error || response.body);
  });
}

function respond(eventUuid, snapshot, customData){
  redisPublish.publish('/response/' + eventUuid, JSON.stringify({snapshot:snapshot, customData:customData}));
}

var targetRegex = /^scxml:\/\/response\/(.*)$/;
var scxmlSessionRegex = /^#_scxml_(.*)$/
var INTERNAL_TARGET = '#_internal';
var httpSessionRegex = /^http(s?):\/\//



function extractBaseUri(uri){
  var url = urlModule.parse(uri);
  var arr = pathModule.parse(url.pathname);
  var pathComponents = url.pathname.split('/');
  url.pathname = pathComponents.slice(0,-1).join('/');
  delete url.path;
  return url.format(url.path);
}

//TODO: store delaye messages in a more robust message queue
//TODO: send along sendid 
function send(serverSendOptions, event, options) {
  console.log('bar');
  //TODO: set event.origin based on _ioprocessors and send type
  //TODO: inject _ioprocessors
  //For now, set the origin to uri - assumes BasicHTTPEventProcessor 
  //FIXME: if token is in the path, then it will probably show up in the origin. Don't want to allow token to leak out via origin. 
  event.origin = serverSendOptions.uri;
	var n;
  console.log('event',event);

  var requestUrl;
  switch(event.type) {
    case 'http://scxml.io/httpLifecycle':
      var targetMatch = event.target.match(targetRegex);
      if(!targetMatch && targetMatch.length) return done(new Error('Received malformed target url'));
      var target = targetMatch[1];

      if(event.name === 'response'){
        respond(target, null, event.data);
      }
      break;
    case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
      //See http://www.w3.org/TR/scxml/#SCXMLEventProcessor
      var scxmlSessionMatch = event.target && event.target.match(scxmlSessionRegex);
      //normalize to event for BasicHTTPEventProcessor 
      if(!event.target){
        targetUrl = serverSendOptions.uri;    
      }else if(event.target === INTERNAL_TARGET){
        //TODO: expose this.raise to send()
        //this.raise(event);   
        throw new Error('Send target=#_internal not yet implemented');
        break;
      }else if(scxmlSessionMatch){
        var targetSessionid = scxmlSessionMatch[1]; 
        var baseUri = extractBaseUri(targetSessionid);
        var targetUrl = baseUri + '/' + targetSessionid;
      }else if(event.target.match(httpSessionRegex)){
        var targetUrl = event.target;
      }
    case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
      if(!targetUrl) targetUrl = event.target;
      //See http://www.w3.org/TR/scxml/#SCXMLEventProcessor
      if(!event.target) {
        n = function () {
          sendEventToSelf(serverSendOptions, event);
        };
      } else {
        n = function(){
          var options = {
            method : 'POST',
            json : event,
            url : targetUrl
          };
          debug('sending event', options);
          request(options,function(error, response, body ) {
            //ignore the response for now
            //TODO: if error results, enqueue error.communication to external queue (event though SCXML spec says inner queue)
          });
        };
      }

      break;
    default:
      console.log('wrong processor', event.type);
      break;
  }

  var timeoutId = setTimeout(n, options.delay || 0);
  if (options.sendid) timeoutMap[options.sendid] = timeoutId;
}

function cancel (sendid) {
  var timeoutId = timeoutMap[sendid];
  if(timeoutId) {
    clearTimeout(timeoutId);
    delete timeoutMap[sendid];
  }
}

module.exports = {
  send: send,
  cancel: cancel
};

