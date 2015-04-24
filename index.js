'use strict';

var scxml = require('scxml'),
  fs = require('fs'),
  path = require('path'),
  uuid = require('uuid'),
  rmdir = require('rimraf'),
  tar = require('tar');

var tmpFolder = 'tmp';
var instanceSubscriptions = {};

module.exports = function () {
  var server = {};
  
  function completeInstantly () {
    //Call last argument
    arguments[arguments.length -1]();
  }

  function getStatechartName (instanceId) {
    return instanceId.split('/')[0]; 
  }

  //Delete old temp folder
  //Create temporary folder for tar streams  
  rmdir.sync(tmpFolder);
  fs.mkdir(tmpFolder);

  server.createStatechartWithTar = function (chartName, pack, done) {
    var statechartFolder = path.join(tmpFolder, chartName);

    rmdir(statechartFolder, function (err) {
      if(err) return done(err);

      fs.mkdir(statechartFolder, function () {
        var extractor = tar.Extract({path: statechartFolder })
          .on('error', function (err) { done(err); })
          .on('end', function () {
            done();
          });

        //Route tar stream to our file system and finalize
        pack.pipe(extractor);
        pack.finalize();
      });
    });
  };

  server.createStatechart = function (chartName, scxmlString, done) {
    //We are doing this because it will cause a bug otherwise
    //if user used tar streams, starts using normal createStatechart endpoint
    var statechartFolder = path.join(tmpFolder, chartName);

    rmdir(statechartFolder, done);
  };

  function react (instanceId, snapshot, event, done) {
    var chartName = getStatechartName(instanceId);

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

   /* instance.listener = {
      onEntry : function(stateId){
        response.write('event: onEntry\n');
        response.write('data: ' + stateId + '\n\n');
      },
      onExit : function(stateId){
        response.write('event: onExit\n');
        response.write('data: ' + stateId + '\n\n');
      }
      //TODO: spec this out
      // onTransition : function(sourceStateId,targetStatesIds){}
    };

    instance.registerListener(instance.listener);*/

    done(null, conf);
  }

  server.createInstance = function (chartName, id, done) {
    var instanceId = chartName + '/' + (id || uuid.v1());

    done(null, instanceId);
  };

  server.startInstance = function (id, done) {
    react(id, null, null, done);
  };

  server.sendEvent = function (id, event, done) {
    //Query snapshot
    var snapshot;

    react(id, snapshot, event, done);
  };

  server.registerListener = function (id, response, done) {
    instanceSubscriptions[id] = instanceSubscriptions[id] || [];

    instanceSubscriptions[id].push(response);

    done();
  };

  //This is a much needed interface on instance deletion
  server.unregisterAllListeners = function (id, done) {
    var subscriptions = instanceSubscriptions[id];

    subscriptions.forEach(function (sub) {
      sub.end();
    });

    delete instanceSubscriptions[id];

    if(done) done();
  };

  server.unregisterListener = function (id, response, done) {
    //instanceSubscriptions
    var subscriptions = instanceSubscriptions[id];

    //TODO: somehow remove using response object?
    //Any unique identifier in response?
    //http://stackoverflow.com/a/26707009/1744033

    if(done) done();
  };

  server.getInstanceSnapshot = completeInstantly;
  server.deleteInstance = completeInstantly;
  server.deleteStatechart = completeInstantly;

  return server;
};
