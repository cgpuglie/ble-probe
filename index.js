const { createBluetooth } = require('node-ble')
const { bluetooth, destroy } = createBluetooth()
const express = require('express');
const server = express();

const { 
    logLevel, initialSleep, loopSleep,
    serviceId, characteristicId,
    deviceAliasPattern, deviceNames,
    metricsPort
} = require('./config.js')

const log = require('loglevel')
log.setLevel(logLevel)

// pattern used to match device alias
const pattern = new RegExp(deviceAliasPattern)

// expose prometheus endpoint
const client = require('prom-client')
const collectDefaultMetrics = client.collectDefaultMetrics
collectDefaultMetrics()

// custom metric for number of probes connected
const numConnected = new client.Gauge({ name: 'probes_connected', help: 'Num of probes currently connected' });
numConnected.set(0) //initially nothing connected

async function timeOut(interval) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true)
        }, interval)
    })
}

function format(any) {
    let base = { timestamp: (new Date()).toISOString(), message: "" }
    return JSON.stringify(Object.assign({}, base, any))
}

// id => bool, should probe be skipped?
let skip = {}
// id => bool, is probe connected to?
let connected = {}
// id, list of connected ids
let deviceIdList = []
// name, list of names in order by how they are assigned
let deviceNameList = deviceNames.split(',')
// id => probe value, used for metric collection
let values = {}

async function main() {
    const adapter = await bluetooth.defaultAdapter()

    // Start discovery
    log.info(format({ message: "starting discovery" }))
    if (! await adapter.isDiscovering())
        await adapter.startDiscovery()

    // Handle ctrl+c
    process.on('SIGINT', function() {
        console.log(format({ message: "caught SIGINT, shutting down..." }))
        adapter.stopDiscovery().then(() => {
            destroy()
            process.exit();
        })
    });

    // serve metrics endpoint
    server.get('/metrics', async (_, res) => {
        try {
            res.set('Content-Type', client.register.contentType);
            res.end(await client.register.metrics());
        } catch (ex) {
            res.status(500).end(ex);
        }
    });

    server.listen(metricsPort)

    // wait for devices
    log.trace(format({ sleep: initialSleep }))
    await timeOut(initialSleep)

    let deviceIds = await adapter.devices()
    deviceIds = deviceIds.sort() // connect in the same order each time
    log.trace(format({ discovered: deviceIds }))

    // Continuously attempt connections
    while (true) {
        for (let i = 0; i < deviceIds.length; i++) {
            const id = deviceIds[i]
            log.trace(format({checking: id, index: i}))

            // skip if marked as connected or ignored
            if (skip[id] || connected[id]) {
                log.trace(format({ skipped: true, id: id }))
                continue
            }

            let device
            let alias
            try {
                device = await adapter.getDevice(id)
                alias = await device.getAlias()
            } catch (e) {
                log.error({message: `Failed to get device info for '${id}'`, error: e})
                continue
            }

            // skip if device is not a bbq probe
            if (!alias.match(pattern)) {
                skip[id] = true
                log.trace(format({ skipped: true, alias }))
                continue
            }

            log.info(format({ connecting: id }))
            
            // only do this on first connect
            let firstConnect = (connected[id] == null)
            if (firstConnect) {
                // create events
                await device.on('connected', (_) => {
                    log.info(format({id, connected: connected[id]}))
                })
                await device.on('disconnect', (_) => {
                    connected[id] = false
                    numConnected.dec()
                    log.info(format({ id, connected: connected[id] }))
                })
            }

            try {
                await device.connect()
                // mark as connected
                connected[id] = true
                numConnected.inc()
                
                // look up name for current probe
                deviceIdList.push(id)
                let nameIndex = deviceIdList.indexOf(id)
                let deviceName = deviceNameList[nameIndex]

                if (firstConnect) {
                    const gatt = await device.gatt()
                    const service = await gatt.getPrimaryService(serviceId)
                    const characteristic = await service.getCharacteristic(characteristicId)

                    await characteristic.startNotifications()
                    characteristic.on('valuechanged', function handler(buffer) {
                        try {
                            let cel = Number(buffer.toString().substr(1)) // remove d prefix, starts as a decimal format string
                            let f = (cel * 1.8) + 32 // convert to farenheight
                            
                            log.info({id, deviceName, value: f})
                            values[id] = f
                        }
                        catch (e) {
                            log.error({message: `failed to parse value '${buffer.toString()}'`, error: e})
                        }
                    })

                    // collect probe data as a custom metric
                    new client.Gauge({
                        name: `${deviceName}_temperature`,
                        help: `Current probe temperature value for '${id}'`,
                        collect() {
                            this.set(values[id]);
                        },
                    });
                }
            }
            catch (e) {
                log.error({message: `connection attempt to device '${id}' failed.`, error: e})
                continue
            }
        }
        
        log.trace(format({ sleep: loopSleep }))
        await timeOut(loopSleep)
    }
}

main().then(console.log).catch(console.error)
