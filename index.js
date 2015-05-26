'use strict';

var scxml = require('scxml'),
  uuid = require('uuid'),
  request = require('request');

var instanceSubscriptions = {};

module.exports = function (db, model) {
  var server = {};
  var timeoutMap = {};
  
  function completeInstantly () {
    //Call last argument
    arguments[arguments.length -1]();
  }

  function sendEventToSelf(event, sendUrl){
    var selfUrl = sendUrl || process.env.SEND_URL + event.origin;
    
    var options = {
      method : 'POST',
      json : event,
      url : selfUrl
    };

    console.log('sending event to self', options);

    request(options,function(error, response){
      if(error) console.error('error sending event to server', error || response.body);
    });
  }

  function react (instanceId, snapshot, event, sendUrl, done) {
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

    var instance = new scxml.scion.Statechart(model, {
      snapshot: snapshot,
      sessionid: instanceId,
      customSend: function (event, options, sendUrl) {
        console.log('customSend',event);

        var n;

        switch(event.type) {
          case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
            //normalize to an HTTP event
            //assume this is of the form '/foo/bar/bat'
          case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
            if(!event.target) {
              n = function () {
                sendEventToSelf(event, sendUrl);
              };
            } else {
              n = function(){
                var options = {
                  method : 'POST',
                  json : event,
                  url : event.target
                };
                request(options,function(error, body, response ) {
                  //ignore the response for now
                  //console.log('send response', body);
                });
              };
            }

            break;

          case 'http://scxml.io/scxmld':
            if(event.target === 'scxml://publish'){
              var subscriptions = instanceSubscriptions[instanceId];
              console.log('subscriptions for instance', instanceId, subscriptions);
              subscriptions.forEach(function(response){
                console.log('response',response);
                response.write('event: ' + event.name + '\n');
                response.write('data: ' + JSON.stringify(event.data) + '\n\n');
              });
            } 
            break;
          default:
            console.log('wrong processor', event.type);
            break;
        }

        var timeoutId = setTimeout(n, options.delay || 0);
        if (options.sendid) timeoutMap[options.sendid] = timeoutId;
      },
      customCancel: function (sendid) {
        clearTimeout(timeoutMap[sendid]);
        delete timeoutMap[sendid];
      }
    });

    instance.registerListener({
      onEntry: publishChanges('onEntry'),
      onExit: publishChanges('onExit')
    });

    //Don't start the instance from the beginning if there no snapshot
    if(!snapshot) instance.start();

    //Process the event
    if(event) instance.gen(event);

    //Get final configuration
    var conf = instance.getSnapshot();
    
    done(null, conf);

    function publishChanges (eventName) {
      return function (stateId) {
        var subscriptions = instanceSubscriptions[instanceId];

        if(!subscriptions) return;

        subscriptions.forEach(function (response) {
          response.write('event: ' + eventName +'\n');
          response.write('data: ' + stateId + '\n\n');
        });
      };
    }
  }

  server.createInstance = function (id, done) {
    var instanceId = id || uuid.v1();

    done(null, instanceId);
  };

  server.startInstance = function (id, sendUrl, done) {
    react(id, null, null, sendUrl, done);
  };

  server.sendEvent = function (id, event, sendUrl, eventUuid, done, respond) {
    if(event.name === 'system.start') {
      server.startInstance(id, sendUrl, finish);
    } else {
      db.getInstance(id, function (err, snapshot) {
        react(id, snapshot, event, sendUrl, finish);
      });
    }

    function finish (err, conf) {
      done(null, conf);
      respond(eventUuid, conf);
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
