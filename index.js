'use strict';

var scxml = require('scxml'),
  fs = require('fs'),
  path = require('path'),
  uuid = require('uuid'),
  rmdir = require('rimraf'),
  tar = require('tar'),
  sendAction = require('./sendAction');

var tmpFolder = 'tmp';
var instanceSubscriptions = {};

module.exports = function (db) {
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

    var chartName = getStatechartName(instanceId);
    var statechartFolder = path.join(tmpFolder, chartName);

    fs.exists(statechartFolder, function (exists) {
      if(exists) {
        var mainFilePath = path.resolve(path.join(statechartFolder, 'index.scxml'));

        scxml.pathToModel(mainFilePath, createAndStartInstance);
      } else {
        db.getStatechart(chartName, function (err, scxmlString) {
          if(err) return done(err);

          scxml.documentStringToModel(null, scxmlString, createAndStartInstance);  
        });
      }
    });
    
    function createAndStartInstance (err, model) {
      if(err) return done(err);
      
      var instance = new scxml.scion.Statechart(model, {
        snapshot: snapshot,
        sessionid: instanceId,
        customSend: sendAction
      });

      //console.log(instance);

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

      console.log('conf1', conf);

      return done(null, conf);
    }

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

  server.createInstance = function (chartName, id, done) {
    var instanceId = chartName + '/' + (id || uuid.v1());

    done(null, instanceId);
  };

  server.startInstance = function (id, done) {
    react(id, null, null, done);
  };

  server.sendEvent = function (id, event, done) {
    var chartName = getStatechartName(id);

    db.getInstance(chartName, id, function (err, snapshot) {
      console.log(id, snapshot, event);
      react(id, snapshot, event, done);
    });
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
  server.deleteStatechart = completeInstantly;

  return server;
};
