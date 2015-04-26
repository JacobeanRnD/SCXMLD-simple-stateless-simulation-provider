'use strict';

var request = require('request');
var _ = require('underscore');
var validateUriRegex = /\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/i;

function sendEventToSelf(event){
  console.log('SEND_URL', process.env.SEND_URL);
  var selfUrl = process.env.SEND_URL + event.origin;

  //console.log('sending event to self', event);
  console.log('self url', selfUrl);

  request({
    method : 'POST',
    json : event,
    url : selfUrl
  },function(error, response){
    if(error) console.error('error sending event to server', error || response.body);
  });
}

module.exports = function (event, options) {
	var n;

  //Default to scxml processor
  event.type = event.type || 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor';

  console.log('send action event', event);

  switch(event.type) {
    case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
      //normalize to an HTTP event
      //assume this is of the form '/foo/bar/bat'
    case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
      if(!event.target) {
        n = function () {
          sendEventToSelf(event);
        };
      } else {
        var targetIsValidUri = validateUriRegex.test(event.target);
        if(!targetIsValidUri){
          return this.raise({ name : 'error.execution', data: 'Target is not valid URI', sendid: options.sendid });
        }

        n = function(){
          request({
            method : 'POST',
            json : event,
            url : event.target
          },function(error, response, body ) {
            if(error){
              sendEventToSelf(_.extend(event, { name : 'send.' + options.sendid + '.got.error',  data : error }));
            }else{
              sendEventToSelf(_.extend(event, {
                name : 'send.' + options.sendid + '.got.success', 
                data : {
                  body : body,
                  response : response
                }
              })); 
            }
          });
        };
      }

      break;
    default:
      console.log('wrong processor', event.type);
      this.raise({ name : 'error.execution', data: 'Unsupported event processor type', sendid: options.sendid });

      break;
  }

  var delay = options.delay;
  var timeoutId = setTimeout(n,delay || 1);

  this._timeoutMap = this._timeoutMap || [];

  if (options.sendid) this._timeoutMap[options.sendid] = timeoutId;
};