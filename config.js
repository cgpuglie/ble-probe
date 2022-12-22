function nothing(val) {
    return val
}

function getWithDefault(varName, def, parse = nothing) {
    return parse(process.env[varName]) || def
}

module.exports = {
    logLevel: getWithDefault('LOG_LEVEL', 'INFO'),
    initialSleep: getWithDefault('INITIAL_SLEEP_MS', 500, Number),
    loopSleep: getWithDefault('LOOP_SLEEP_MS', 30000, Number),
    serviceId: getWithDefault('SERVICE_ID', '18424398-7cbc-11e9-8f9e-2a86e4085a59'),
    characteristicId: getWithDefault('CHARACTERISTIC_ID', '772ae377-b3d2-ff8e-1042-5481d1e03456'),
    deviceAliasPattern: getWithDefault('DEVICE_ALIAS_PATTERN', 'BBQ'),
    deviceNames: getWithDefault('DEVICE_NAMES', 'probe1,probe2')
}