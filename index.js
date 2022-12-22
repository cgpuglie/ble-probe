const { createBluetooth } = require('node-ble')
const { bluetooth, destroy } = createBluetooth()
const { 
    logLevel, initialSleep, loopSleep,
    serviceId, characteristicId,
    deviceAliasPattern
} = require('./config.js')

const log = require('loglevel')
log.setLevel(logLevel)

const pattern = new RegExp(deviceAliasPattern)

async function timeOut(interval) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true)
        }, interval)
    })
}

function format(any) {
    let base = { timestamp: (new Date()).toISOString(), message: "" }
    return JSON.stringify(Object.assign({}, any, base))
}

let skip = {}
async function main() {
    const adapter = await bluetooth.defaultAdapter()

    // Start discovery
    log.info(format({ message: "starting discovery" }))
    if (! await adapter.isDiscovering())
        await adapter.startDiscovery()

    // Handle ctrl+c
    process.on('SIGINT', function() {
        log.info(format({ message: "caught SIGINT, shutting down..." }))
        adapter.stopDiscovery().then(() => {
            destroy()
            process.exit();
        })
    });

    // wait for devices
    log.trace(format({ sleep: initialSleep }))
    await timeOut(initialSleep)

    const deviceIds = await adapter.devices()
    log.trace(format({ discovered: deviceIds }))

    // Continuously attempt connections
    while (true) {
        for (let i = 0; i < deviceIds.length; i++) {
            if (Object.keys(skip).length == deviceIds.length) {
                // all IDs are either connected or don't match
                break
            }

            const id = deviceIds[i]
            log.trace(format({checking: id, index: i}))

            // skip if marked as connected or ignored
            if (skip[id]) {
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
            // create events
            await device.on('connected', (_) => {
                log.info(format({connected: id}))
            })
            await device.on('disconnect', (_) => {
                log.info(format({ disconnected: id }))
            })

            try {
                await device.connect()
                // mark as connected
                skip[id] = true

                const gatt = await device.gatt()
                const service = await gatt.getPrimaryService(serviceId)
                const characteristic = await service.getCharacteristic(characteristicId)

                await characteristic.startNotifications()
                characteristic.on('valuechanged', createHandler(id))
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

function createHandler(id) {
    return function handler(buffer) {
        log.info({id, value: buffer.toString()})
    }
}

main().then(console.log).catch(console.error)
