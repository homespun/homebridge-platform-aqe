/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true */

var connection  = require('mqtt-connection')
  , homespun    = require('homespun-discovery')
  , inherits    = require('util').inherits
  , net         = require('net')
  , pushsensor  = homespun.utilities.pushsensor
  , PushSensor  = pushsensor.Sensor
  , sensorTypes = homespun.utilities.sensortypes
  , underscore  = require('underscore')


var Accessory
  , Characteristic
  , Service
  , CommunityTypes
  , UUIDGen

module.exports = function (homebridge) {
  Accessory      = homebridge.platformAccessory
  Service        = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  CommunityTypes = require('hap-nodejs-community-types')(homebridge)
  UUIDGen        = homebridge.hap.uuid

  pushsensor.init(homebridge)
  homebridge.registerPlatform('homebridge-platform-aqe', 'AQE', AQE, true)
}


var AQE = function (log, config, api) {
  if (!(this instanceof AQE)) return new AQE(log, config, api)

  this.log = log
  this.config = config || { platform: 'AQE' }
  this.api = api

  this.options = underscore.defaults(this.config.options || {}, { verboseP: false })

  this.discoveries = {}
  this.eggs = {}

  if (api) this.api.on('didFinishLaunching', this._didFinishLaunching.bind(this))
  else this._didFinishLaunching()
}

AQE.prototype._didFinishLaunching = function () {
  var self = this

  net.Server().on('connection', function (socket) {
    var clientId
    var client = connection(socket)

    client.on('connect', function (packet) {
      clientId = packet.clientId

      client.connack({ returnCode: 0 })
     }).on('publish', function (packet) {
      var capabilities, egg, model, properties, readings, topic

      if (packet.topic.indexOf('/orgs/wd/aqe/') !== 0) return self.log.warn('unexpected topic', packet)

      if (packet.qos > 0) return self.log.warn('unexpected QoS', packet)

      try { packet.payload = JSON.parse(packet.payload) } catch(ex) {
        return self.log.error('error parsing payload', packet)
      }

      egg = self.eggs[clientId]
      if (egg) egg.timestamp = underscore.now()

      topic = packet.topic.split('/')[4]
      if (topic !== 'heartbeat') {
        if (!egg) return self.log.warn('unexpected publish', packet)

        egg = egg.egg
        readings = egg._normalize.bind(egg)(topic, packet.payload)
        underscore.extend(egg.readings, readings)
        return egg._update.bind(egg)(readings)
      }

      if (egg) return

/* { serial-number    : '...'
   , converted-value  : ...
   , firmware-version : '...'
   , publishes        : [ co, co2, humidity, no2, o3, particulate, pm, so2, temperature, voc ]
   , counter          : ...
   }
 */
      underscore.keys(Egg.models).forEach(function (key) {
        if ((!model) && (underscore.difference(Egg.models[key].publishes, packet.payload.publishes).length === 0)) model = key
      })
      capabilities = {}
      packet.payload.publishes.forEach(function (key) {
        var key2 = key

        if ((key === 'particulate') || (key === 'pm')) key2 = 'particles.2_5'
        capabilities[key2] = sensorTypes[key2]
        if (key === 'voc') capabilities.co2 = sensorTypes.co2
      })

      properties = { name             : clientId
                   , manufacturer     : 'Wicked Device'
                   , model            : model || 'AQEV2FW'
                   , serialNumber     : packet.payload['serial-number']
                   , firmwareRevision : packet.payload['firmware-version']
                   , hardwareRevision : ''
                   }

      self.eggs[clientId] = { egg: new Egg(self, clientId,  { capabilities: capabilities, properties: properties }),
                              timestamp: underscore.now() }
    }).on('pingreq', function () {
      client.pingresp()
    }).on('subscribe', function (packet) {
      try { packet.payload = JSON.parse(packet.payload) } catch(ex) {}
      self.log.error('unexpected subscribe', packet)
      client.destroy()
    }).on('close', function () {
      self.log.debug('MQTT close')
      client.destroy()
    }).on('error', function (err) {
      if (err.errno !== 'ECONNRESET') self.log.info('MQTT error', err)
      client.destroy()
    }).on('disconnect', function () {
      self.log.debug('MQTT disconnect')
      client.destroy()
    })

    socket.on('timeout', function () {
      client.destroy()
    }).setTimeout(5 * 60 * 1000)
  }).listen(1883)

  setTimeout(function () {
    underscore.keys(self.discoveries).forEach(function (uuid) {
      var accessory = self.discoveries[uuid]

      self.log.warn('accessory not (yet) discovered', { UUID: uuid })
      accessory.updateReachability(false)
    })
  }.bind(self), 5 * 1000)

  self.log('didFinishLaunching')
}

AQE.prototype._addAccessory = function (sensor) {
  var self = this

  var accessory = new Accessory(sensor.name, sensor.uuid)

  accessory.on('identify', function (paired, callback) {
    self.log(accessory.displayName, ': identify request')
    callback()
  })

  if (sensor.attachAccessory.bind(sensor)(accessory)) self.api.updatePlatformAccessories([ accessory ])

  if (!self.discoveries[accessory.UUID]) {
    self.api.registerPlatformAccessories('homebridge-platform-aqe', 'AQE', [ accessory ])
    self.log('addAccessory', underscore.pick(sensor,
                                             [ 'uuid', 'name', 'manufacturer', 'model', 'serialNumber', 'firmwareRevision' ]))
  }
}

AQE.prototype.configurationRequestHandler = function (context, request, callback) {/* jshint unused: false */
  this.log('configuration request', { context: context, request: request })
}

AQE.prototype.configureAccessory = function (accessory) {
  var self = this

  accessory.on('identify', function (paired, callback) {
    self.log(accessory.displayName, ': identify request')
    callback()
  })

  self.discoveries[accessory.UUID] = accessory
  self.log('configureAccessory', underscore.pick(accessory, [ 'UUID', 'displayName' ]))
}

var Egg = function (platform, sensorId, service) {
  if (!(this instanceof Egg)) return new Egg(platform, sensorId, service)

  PushSensor.call(this, platform, sensorId, service)
}
inherits(Egg, PushSensor);

Egg.models = 
{ 'AQEV2FW_CO2_ESP'    : { publishes : [ 'co2',                               'humidity', 'temperature' ]
                         , sensors   : [ 'SE-0018',                           'SHT25'                   ]
                         }
, 'AQEV2FW_NO2CO_ESP'  : { publishes : [ 'co',              'no2',            'humidity', 'temperature' ]
                         , sensors   : [ '3SP-CO-1000-PCB', '3SP-NO2-20-PCB', 'SHT25'                   ]
                         }
, 'AQEV2FW_NO2O3_ESP'  : { publishes : [ 'no2',             'o3',             'humidity', 'temperature' ]
                         , sensors   : [ 'NO2-B4-ISB',      '3SP-O3-20-PCB',  'SHT25'                   ]
                         }
                                       // pm == particulate
, 'AQEV2FW_PM'         : { publishes : [ 'pm',                                'humidity', 'temperature' ]
                         , sensors   : [ 'PPD60PV-T2',                        'SHT25'                   ]
                         }
, 'AQEV2FW_PM_ESP'     : { publishes : [ 'pm',                                'humidity', 'temperature' ]
                         , sensors   : [ 'PPD60PV-T2',                        'SHT25'                   ]
                         }
, 'AQEV2FW_SO2O3'      : { publishes : [ 'o3',              'so2',            'humidity', 'temperature' ]
                         , sensors   : [ '3SP-O3-20-PCB',   '3SP-SO2-20-PCB', 'SHT25'                   ]
                         }
, 'AQEV2FW_SO2O3_ESP'  : { publishes : [ 'o3',              'so2',            'humidity', 'temperature' ]
                         , sensors   : [ '3SP-O3-20-PCB',   '3SP-SO2-20-PCB', 'SHT25'                   ]
                         }
, 'AQEV2FW_USFS_ESP'   : { publishes : [ 'particulate',                       'humidity', 'temperature' ]
                         , sensors   : [ 'DN7C3CA006',                        'AM2302'                  ]
                         }
, 'AQEV2FW_VOC_ESP'    : { publishes : [ 'voc',                               'humidity', 'temperature' ]
                         , sensors   : [ 'AMS iAQ-core C',                    'SHT25'                   ]
                         }
}

/* { serial-number                  : '...'
   , sensor-part-number             : '...'

   // all EXCEPT voc
   , raw-value                      : ...
   , raw-units                      : '...'
   , converted-value                : ...
   , converted-units                : '...'
     // degC   : temperature
     // degF   :   ..
     // percent: humidity
     // ppm    : co, co2, voc
     // ppb    : no2(ppm), o3, so2, tvoc
     // ug/m^3 : particulate
   , raw-instant-value              : ...      // optional
   , compensated-value              : ...      // optional

   // voc
   , raw-instant-co2                : ...
   , converted-co2                  : ...
   , compensated-co2                : ...
   , compensated-instant-co2        : ...
   , co2-units                      : 'ppm'
   , raw-instant-tvoc               : ...
   , converted-tvoc                 : ...
   , compensated-tvoc               : ...
   , compensated-instant-tvoc       : ...
   , tvoc-units                     : 'ppb'
   , raw-instant-resistance         : ...
   , converted-resistance           : ...
   , compensated-resistance         : ...
   , compensated-instant-resistance : ...
   , resistance-units               : 'ohm'
   }   
 */

Egg.prototype._normalize = function (topic, payload) {
  var v
  var readings = {}

  if (topic !== 'voc') {
    v = typeof payload['compensated-value'] !== 'undefined' ? payload['compensated-value'] : payload['converted-value']

    // TODO: commpare the capability to the converted-units
    if ((topic === 'no2') && (payload['converted-units'] === 'ppb')) v *= 1000.0
    if ((topic === 'temperature') && (payload['converted-units'] === 'degF')) v = ((v - 32.0) * 5.0) / 9.0
    readings[topic] = v
  } else {
    readings[topic] = typeof payload['compensated-tvoc'] !== 'undefined'
                        ? payload['compensated-tvoc'] : payload['converted-tvoc']
    readings.co2 = typeof payload['compensated-co2'] !== 'undefined'
                        ? payload['compensated-co2'] : payload['converted-co2']
  }

  return readings
}
