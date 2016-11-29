# homebridge-platform-snmp
An [Air Quality Egg](http://airqualityegg.com/) platform plugin for [Homebridge](https://github.com/nfarina/homebridge).

# Installation
Run these commands:

    % sudo npm install -g homebridge
    % sudo npm install -g homebridge-platform-aqe

# Homebridge Configuration
This is a "dynamic" platform plugin,
so if you're already running `homebridge` on your system,
then you already have a `~/.homebridge/config.json` file and no configuration is needed!

If this is your first time with `homebridge`,
this will suffice:

    { "bridge":
      { "name": "Homebridge"
      , "username": "CC:22:3D:E3:CE:30"
      , "port": 51826
      , "pin": "031-45-154"
      }
    , "description": ""
    , "accessories":
      [
      ]
    , "platforms":
      [
      ]
    }

# AQE Configuration
Connect your Egg's USB cable to your computer,
and launch Serial Monitor program.
Make sure that `EOL` is set to `Carriage Return1,
and that the `Baud Rate` is set to `115200`.

Type `aqe` when the Egg starts and,
after initialization,
you'll be in configuration mode.
Type these three commands:

    mqttsrv mqtt.example.com
    mqttauth disable
    exit

where `mqtt.example.com` is the domain-name of the machine that is running Homebridge.
(It would be better if the Egg would allow an IP address for the MQTT server,
but it requires a domain-name.)

Personally,
I also like to set these as well prior to the `exit` command:

    backlight alwayson
    use ntp
    ntpsrv pool.ntp.org
