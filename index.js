'use strict';

var scxml = require('scxml'),
  uuid = require('uuid'),
  request = require('request');


//TODO: fix this ugly, non-standards-compiant interface
scxml.scion.ioProcessorTypes.smaas = { location: 'http://scxml.io/httpLifecycle' };

var instanceSubscriptions = {};

module.exports = function (db, model, modelName) {
  var server = {};
  var timeoutMap = {};
  
  function completeInstantly () {
    //Call last argument
    arguments[arguments.length -1]();
  }

  function react (instanceId, snapshot, event, sendOptions, eventUuid, done) {

    //Check if chartname.scxml folder exists
      //If it does
      //Use scxml.pathToModel
    //else
    //Query db for statechart content
    //Use documentStringToModel
    //Get model
    //Create instance
    //Add listeners
    //Start instance with or without snapshot
      //If event exists
      //Send the event
    //Return config

    var wait = false;

    var instance = new scxml.scion.Statechart(model, {
      snapshot: snapshot,
      sessionid: instanceId,
      customSend : function(event, options) {
        //TODO: set event.origin based on _ioprocessors and send type
        //TODO: inject _ioprocessors
        //For now, set the origin to uri - assumes BasicHTTPEventProcessor 
        //FIXME: if token is in the path, then it will probably show up in the origin. Don't want to allow token to leak out via origin. 
        event.origin = sendOptions.uri;
        var n;
        console.log('customSend event',event);

        var requestUrl;
        switch(event.type) {
          case 'http://scxml.io/httpLifecycle':
            var targetMatch = event.target.match(targetRegex);
            if(!targetMatch && targetMatch.length) return done(new Error('Received malformed target url'));
            var target = targetMatch[1];

            if(event.name === 'response'){
              respond(target, null, event.data);
            } else if(event.name === 'wait'){
              wait = true;
            }
            break;
          case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
            //See http://www.w3.org/TR/scxml/#SCXMLEventProcessor
            var scxmlSessionMatch = event.target && event.target.match(scxmlSessionRegex);
            //normalize to event for BasicHTTPEventProcessor 
            if(!event.target){
              targetUrl = sendOptions.uri;    
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
                sendEventToSelf(sendOptions, event);
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
      },
      customCancel : function(sendid) {
        var timeoutId = timeoutMap[sendid];
        if(timeoutId) {
          clearTimeout(timeoutId);
          delete timeoutMap[sendid];
        }
      }
    });

    instance.registerListener({
      onEntry: publishChanges.bind(this,'onEntry'),
      onExit: publishChanges.bind(this,'onExit')
    });

    //Don't start the instance from the beginning if there no snapshot
    if(!snapshot) instance.start();

    //Process the event
    if(event){
      event.uuid = eventUuid;   //tag event with the uuid for <respond>
      instance.gen(event);
    }

    //Get final configuration
    var conf = instance.getSnapshot();

    if(!wait){
      respond(eventUuid, conf);
    }
    
    done(null, conf);

    //TODO: refactor to go through redis. otherwise, this won't be stateless/scalable.
    function publishChanges (eventName, stateId) {
      var subscriptions = instanceSubscriptions[instanceId];

      if(!subscriptions) return;

      subscriptions.forEach(function (response) {
        response.write('event: ' + eventName +'\n');
        response.write('data: ' + stateId + '\n\n');
      });
    }
  }

  server.createInstance = function (id, done) {
    var instanceId = id || uuid.v1();

    done(null, instanceId);
  };

  server.startInstance = function (id, sendOptions, eventUuid, done) {
    react(id, null, null, sendOptions, eventUuid, done);
  };

  server.sendEvent = function (id, event, sendOptions, eventUuid, done) {
    if(event.name === 'system.start') {
      server.startInstance(id, sendOptions, eventUuid, done);
    } else {
      db.getInstance(modelName, id, function (err, snapshot) {
        react(id, snapshot, event, sendOptions, eventUuid, done);
      });
    }
  };

  server.registerListener = function (id, response, done) {
    instanceSubscriptions[id] = instanceSubscriptions[id] || [];

    instanceSubscriptions[id].push(response);

    done();
  };

  //This is a much needed interface on instance deletion
  server.unregisterAllListeners = function (id, done) {
    var subscriptions = instanceSubscriptions[id];

    if(!subscriptions) return done();

    subscriptions.forEach(function (response) {
      response.end();
    });

    delete instanceSubscriptions[id];

    if(done) done();
  };

  server.unregisterListener = function (id, response, done) {
    //instanceSubscriptions
    var subscriptions = instanceSubscriptions[id];

    if(!subscriptions) return done();
    //TODO: somehow remove using response object?
    //Any unique identifier in response?
    //http://stackoverflow.com/a/26707009/1744033
    instanceSubscriptions[id] = subscriptions.filter(function (subResponse) {
      if(response.uniqueId === subResponse.uniqueId) {
        response.end();
        return false;
      }

      return true;
    });

    if(done) done();
  };

  server.getInstanceSnapshot = completeInstantly;
  server.deleteInstance = completeInstantly;

  return server;
};

// send action

var redis = require('redis'),
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
  console.log('Responding',eventUuid, snapshot, customData);
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


