const { createBluetooth } = require('node-ble')
const { bluetooth, destroy } = createBluetooth()

const serviceId = "18424398-7cbc-11e9-8f9e-2a86e4085a59"
const characteristicId = "772ae377-b3d2-ff8e-1042-5481d1e03456"

async function timeOut(interval) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true)
        }, interval)
    })
}

async function main() {
    const adapter = await bluetooth.defaultAdapter()

    console.log("Starting discovery")
    if (! await adapter.isDiscovering())
        await adapter.startDiscovery()


    console.log("Waiting...")
    await timeOut(6000)

    console.log("Listing devices")
    const deviceIds = await adapter.devices()
    console.log(JSON.stringify(deviceIds, null, 2))

    console.log("Finding probes")
    let probeIds = []
    let devices = []
    for (let i = 0; i < deviceIds.length; i++) {
        const deviceId = deviceIds[i]

        const device = await adapter.getDevice(deviceId)
        const alias = await device.getAlias()

        if (alias == "BBQ") {
            probeIds.push(await device.getAddress())
            devices.push(device)
        }
    }
    probeIds = probeIds.sort()

    console.log(`Found: "${JSON.stringify(probeIds)}"`)

    console.log("Getting services")
    for (let i = 0; i < devices.length; i++) {
        const device = devices[i]
        await device.connect()
        const gattServer = await device.gatt()
        const serviceIds = await gattServer.services()
        console.log(`${probeIds[i]}: has services: ${JSON.stringify(serviceIds, null, 2)}`)
        for (let j = 0; j < serviceIds.length; j++) {
            const serviceId = serviceIds[j]
            const service = await gattServer.getPrimaryService(serviceId)
            let characteristics = await service.characteristics()
            console.log(`${probeIds[i]}/${serviceId}: has characteristics ${JSON.stringify(characteristics, null, 2)}`)
            console.log(`${serviceId} toString: ${service.toString()}`)
        }
        await device.disconnect()
    }

    console.log("Shutting down")
    await adapter.stopDiscovery()
    destroy()
}

main().then(console.log).catch(console.log)
