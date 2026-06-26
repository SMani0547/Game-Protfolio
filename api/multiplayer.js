const rooms = globalThis.__portfolioMultiplayerRooms ?? new Map()
globalThis.__portfolioMultiplayerRooms = rooms

const CLIENT_TIMEOUT = 30000

function sanitizeName(value)
{
    return `${value || 'Player'}`
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 16) || 'Player'
}

function sanitizeRoomCode(value)
{
    return `${value || ''}`
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 12)
}

function send(client, message)
{
    if(client.closed)
        return

    client.response.write(`data: ${JSON.stringify(message)}\n\n`)
}

function getRoom(roomCode)
{
    let room = rooms.get(roomCode)

    if(!room)
    {
        room = {
            code: roomCode,
            clients: new Map(),
        }
        rooms.set(roomCode, room)
    }

    return room
}

function removeClient(room, playerId)
{
    const client = room.clients.get(playerId)

    if(!client)
        return

    client.closed = true
    clearInterval(client.keepAlive)
    room.clients.delete(playerId)

    broadcast(room, {
        type: 'leave',
        roomCode: room.code,
        player: {
            id: playerId,
            name: client.name,
        },
        sentAt: Date.now(),
    }, playerId)

    if(room.clients.size === 0)
        rooms.delete(room.code)
}

function broadcast(room, message, exceptPlayerId = null)
{
    cleanupRoom(room)

    for(const client of room.clients.values())
    {
        if(client.playerId === exceptPlayerId)
            continue

        send(client, message)
    }
}

function cleanupRoom(room)
{
    const now = Date.now()

    for(const client of [...room.clients.values()])
    {
        if(now - client.lastSeen > CLIENT_TIMEOUT)
            removeClient(room, client.playerId)
    }
}

async function readJson(request)
{
    if(request.body && typeof request.body === 'object')
        return request.body

    const chunks = []

    for await (const chunk of request)
        chunks.push(chunk)

    if(chunks.length === 0)
        return {}

    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function setCors(response)
{
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function handleEvents(request, response)
{
    const url = new URL(request.url, `https://${request.headers.host}`)
    const roomCode = sanitizeRoomCode(url.searchParams.get('room'))
    const playerId = `${url.searchParams.get('player') || ''}`.slice(0, 80)
    const name = sanitizeName(url.searchParams.get('name'))

    if(!roomCode || !playerId)
    {
        response.statusCode = 400
        response.end('Missing room or player')
        return
    }

    setCors(response)
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })
    response.write('\n')

    const room = getRoom(roomCode)

    const existingClient = room.clients.get(playerId)
    if(existingClient)
        removeClient(room, playerId)

    const client = {
        playerId,
        name,
        response,
        state: null,
        lastSeen: Date.now(),
        closed: false,
        keepAlive: null,
    }

    room.clients.set(playerId, client)

    send(client, {
        type: 'connected',
        roomCode,
        player: { id: playerId, name },
        sentAt: Date.now(),
    })

    for(const otherClient of room.clients.values())
    {
        if(otherClient.playerId === playerId)
            continue

        send(client, {
            type: 'presence',
            roomCode,
            player: {
                id: otherClient.playerId,
                name: otherClient.name,
            },
            state: otherClient.state,
            sentAt: Date.now(),
        })
    }

    broadcast(room, {
        type: 'join',
        roomCode,
        player: { id: playerId, name },
        state: client.state,
        sentAt: Date.now(),
    }, playerId)

    client.keepAlive = setInterval(() =>
    {
        client.lastSeen = Date.now()
        response.write(': keep-alive\n\n')
    }, 15000)

    request.on('close', () =>
    {
        removeClient(room, playerId)
    })
}

async function handleMessage(request, response)
{
    try
    {
        const message = await readJson(request)
        const roomCode = sanitizeRoomCode(message.roomCode)
        const player = message.player || {}
        const playerId = `${player.id || ''}`.slice(0, 80)

        if(!roomCode || !playerId)
        {
            response.statusCode = 400
            response.end(JSON.stringify({ ok: false }))
            return
        }

        const room = rooms.get(roomCode)

        if(!room)
        {
            response.statusCode = 200
            response.end(JSON.stringify({ ok: true }))
            return
        }

        const client = room.clients.get(playerId)
        if(client)
        {
            client.name = sanitizeName(player.name)
            client.lastSeen = Date.now()

            if(message.state)
                client.state = message.state
        }

        if(message.type === 'leave')
        {
            removeClient(room, playerId)
            response.statusCode = 200
            response.end(JSON.stringify({ ok: true }))
            return
        }

        broadcast(room, {
            type: message.type,
            roomCode,
            player: {
                id: playerId,
                name: sanitizeName(player.name),
            },
            state: message.state || null,
            sentAt: Date.now(),
        }, playerId)

        response.statusCode = 200
        response.end(JSON.stringify({ ok: true }))
    }
    catch(error)
    {
        response.statusCode = 500
        response.end(JSON.stringify({ ok: false }))
    }
}

export default async function handler(request, response)
{
    setCors(response)

    if(request.method === 'OPTIONS')
    {
        response.statusCode = 204
        response.end()
        return
    }

    if(request.method === 'GET')
    {
        handleEvents(request, response)
        return
    }

    if(request.method === 'POST')
    {
        response.setHeader('Content-Type', 'application/json')
        await handleMessage(request, response)
        return
    }

    response.statusCode = 405
    response.end('Method not allowed')
}
