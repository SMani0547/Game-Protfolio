import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

export class Multiplayer
{
    constructor()
    {
        this.game = Game.getInstance()

        this.nameStorageKey = 'multiplayerName'
        this.roomCode = null
        this.pendingRoomCode = null
        this.playerId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
        this.players = new Map()
        this.broadcastInterval = 0.15
        this.lastBroadcastTime = 0
        this.remoteTimeout = 4
        this.channel = null
        this.remoteUrl = this.getRemoteUrl()
        this.remoteSource = null
        this.remoteConnected = false

        this.modal = this.game.modals.items.get('multiplayer')
        this.element = this.modal.element

        this.formElement = this.element.querySelector('.js-multiplayer-form')
        this.nameInput = this.element.querySelector('.js-multiplayer-name')
        this.createButton = this.element.querySelector('.js-multiplayer-create')
        this.leaveButton = this.element.querySelector('.js-multiplayer-leave')
        this.roomLinkInput = this.element.querySelector('.js-multiplayer-link')
        this.copyButton = this.element.querySelector('.js-multiplayer-copy')
        this.joinInput = this.element.querySelector('.js-multiplayer-join')
        this.joinButton = this.element.querySelector('.js-multiplayer-join-button')
        this.statusElement = this.element.querySelector('.js-multiplayer-status')
        this.playersElement = this.element.querySelector('.js-multiplayer-players')
        this.labelsElement = document.createElement('div')
        this.labelsElement.classList.add('multiplayer-name-tags')
        this.game.domElement.append(this.labelsElement)

        this.setName()
        this.setTrigger()
        this.setTransport()
        this.setEvents()
        this.setRoomFromUrl()
        this.update()
    }

    setName()
    {
        const storedName = localStorage.getItem(this.nameStorageKey)

        if(storedName)
            this.nameInput.value = this.sanitizeName(storedName)
    }

    setTrigger()
    {
        const element = this.game.domElement.querySelector('.js-multiplayer-trigger')

        element.addEventListener('click', (event) =>
        {
            event.preventDefault()
            this.game.modals.open('multiplayer')
        })

        element.addEventListener('keydown', (event) =>
        {
            event.preventDefault()
        })
    }

    setTransport()
    {
        if(!('BroadcastChannel' in window))
            return

        this.channel = new BroadcastChannel('portfolio-multiplayer-room')
        this.channel.addEventListener('message', (event) =>
        {
            this.onMessage(event.data)
        })
    }

    getRemoteUrl()
    {
        if(import.meta.env.VITE_MULTIPLAYER_URL)
            return import.meta.env.VITE_MULTIPLAYER_URL.replace(/\/$/, '')

        if(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            return ''

        return `${window.location.origin}/api/multiplayer`
    }

    setEvents()
    {
        this.nameInput.addEventListener('input', () =>
        {
            this.nameInput.value = this.sanitizeName(this.nameInput.value)
            this.update()
        })

        this.joinInput.addEventListener('input', () =>
        {
            this.update()
        })

        this.createButton.addEventListener('click', () =>
        {
            this.createRoom()
        })

        this.joinButton.addEventListener('click', () =>
        {
            this.joinFromInput()
        })

        this.copyButton.addEventListener('click', () =>
        {
            this.copyRoomLink()
        })

        this.leaveButton.addEventListener('click', () =>
        {
            this.leaveRoom()
        })

        this.formElement.addEventListener('submit', (event) =>
        {
            event.preventDefault()

            if(this.parseRoomCode(this.joinInput.value))
                this.joinFromInput()
            else
                this.createRoom()
        })

        this.modal.events.on('open', () =>
        {
            if(this.pendingRoomCode && !this.roomCode)
            {
                this.joinInput.value = this.pendingRoomCode
                this.setStatus(`Enter your name to join room ${this.pendingRoomCode}.`)
            }

            this.update()
        })

        this.updateRoomCallback = () =>
        {
            this.updateRoom()
        }
        this.game.ticker.events.on('tick', this.updateRoomCallback, 15)

        window.addEventListener('beforeunload', () =>
        {
            this.sendMessage('leave')
        })
    }

    setRoomFromUrl()
    {
        const url = new URL(window.location.href)
        const roomCode = this.parseRoomCode(url.searchParams.get('room') || '')

        if(!roomCode)
            return

        this.pendingRoomCode = roomCode
        this.joinInput.value = roomCode

        requestAnimationFrame(() =>
        {
            this.game.modals.open('multiplayer')
        })
    }

    sanitizeName(value, trim = false)
    {
        let sanitized = value
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .replace(/\s+/g, ' ')
            .slice(0, 16)

        if(trim)
            sanitized = sanitized.trim()

        return sanitized
    }

    sanitizeRoomCode(value)
    {
        return value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 12)
    }

    parseRoomCode(value)
    {
        const rawValue = `${value || ''}`.trim()

        if(!rawValue)
            return ''

        try
        {
            const url = new URL(rawValue, window.location.origin)
            const queryRoomCode = url.searchParams.get('room')

            if(queryRoomCode)
                return this.sanitizeRoomCode(queryRoomCode)
        }
        catch(error)
        {
            // Treat invalid URLs as room codes.
        }

        return this.sanitizeRoomCode(rawValue)
    }

    getName()
    {
        return this.sanitizeName(this.nameInput.value, true)
    }

    requireName()
    {
        const name = this.getName()

        if(!name)
        {
            this.setStatus('Enter your name first.', 'danger')
            this.nameInput.focus()
            return null
        }

        localStorage.setItem(this.nameStorageKey, name)

        if(this.nameInput.value !== name)
            this.nameInput.value = name

        return name
    }

    createRoom()
    {
        const name = this.requireName()

        if(!name)
            return

        this.joinRoom(this.generateRoomCode(), name, true)
    }

    joinFromInput()
    {
        const name = this.requireName()

        if(!name)
            return

        const roomCode = this.parseRoomCode(this.joinInput.value)

        if(!roomCode)
        {
            this.setStatus('Enter a room code or link.', 'danger')
            this.joinInput.focus()
            return
        }

        this.joinRoom(roomCode, name, false)
    }

    joinRoom(roomCode, name, created = false)
    {
        if(this.roomCode && this.roomCode !== roomCode)
            this.sendMessage('leave')

        this.disconnectRemote()
        this.clearRemotePlayers()

        this.roomCode = roomCode
        this.pendingRoomCode = null
        this.joinInput.value = roomCode
        this.roomLinkInput.value = this.getRoomUrl(roomCode)

        this.players.clear()
        this.players.set(this.playerId, {
            id: this.playerId,
            name,
            local: true,
        })

        this.setUrlRoom(roomCode)
        this.renderPlayers()
        this.setStatus(created ? `Room ${roomCode} created.` : `Joined room ${roomCode}.`, 'success')
        this.connectRemote()
        this.sendMessage('join')
        this.sendMessage('state')
        this.update()
    }

    leaveRoom()
    {
        if(!this.roomCode)
            return

        const previousRoomCode = this.roomCode

        this.sendMessage('leave')
        this.disconnectRemote()
        this.roomCode = null
        this.pendingRoomCode = null
        this.roomLinkInput.value = ''
        this.joinInput.value = ''
        this.clearRemotePlayers()
        this.players.clear()

        this.setUrlRoom(null)
        this.renderPlayers()
        this.setStatus(`Left room ${previousRoomCode}.`)
        this.update()
    }

    generateRoomCode()
    {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const values = new Uint8Array(6)
        crypto.getRandomValues(values)

        let code = ''
        for(const value of values)
            code += alphabet[value % alphabet.length]

        return code
    }

    getRoomUrl(roomCode)
    {
        const url = new URL(window.location.href)
        url.searchParams.set('room', roomCode)
        url.hash = ''

        return url.toString()
    }

    setUrlRoom(roomCode)
    {
        const url = new URL(window.location.href)

        if(roomCode)
            url.searchParams.set('room', roomCode)
        else
            url.searchParams.delete('room')

        history.pushState({}, '', url)
    }

    async copyRoomLink()
    {
        if(!this.roomCode)
            return

        const link = this.getRoomUrl(this.roomCode)
        this.roomLinkInput.value = link

        try
        {
            await navigator.clipboard.writeText(link)
            this.setStatus('Room link copied.', 'success')
        }
        catch(error)
        {
            this.roomLinkInput.focus()
            this.roomLinkInput.select()
            document.execCommand('copy')
            this.setStatus('Room link copied.', 'success')
        }
    }

    connectRemote()
    {
        if(!this.remoteUrl || !this.roomCode)
            return

        const url = new URL(this.remoteUrl, window.location.origin)
        url.searchParams.set('room', this.roomCode)
        url.searchParams.set('player', this.playerId)
        url.searchParams.set('name', this.getName())

        this.remoteSource = new EventSource(url.toString())

        this.remoteSource.addEventListener('open', () =>
        {
            this.remoteConnected = true
            this.setStatus(`Joined room ${this.roomCode}. Online sync ready.`, 'success')
        })

        this.remoteSource.addEventListener('message', (event) =>
        {
            try
            {
                this.onMessage(JSON.parse(event.data))
            }
            catch(error)
            {
                // Ignore malformed room messages.
            }
        })

        this.remoteSource.addEventListener('error', () =>
        {
            if(!this.roomCode)
                return

            this.remoteConnected = false
            this.setStatus(`Joined room ${this.roomCode}. Online sync reconnecting...`)
        })
    }

    disconnectRemote()
    {
        if(!this.remoteSource)
            return

        this.remoteSource.close()
        this.remoteSource = null
        this.remoteConnected = false
    }

    sendMessage(type)
    {
        if(!this.roomCode)
            return

        const message = {
            type,
            roomCode: this.roomCode,
            player: {
                id: this.playerId,
                name: this.getName(),
            },
            state: this.getLocalState(),
            sentAt: Date.now(),
        }

        if(this.channel)
            this.channel.postMessage(message)

        this.sendRemoteMessage(message)
    }

    sendRemoteMessage(message)
    {
        if(!this.remoteUrl || !this.roomCode)
            return

        fetch(this.remoteUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
            keepalive: message.type === 'leave',
        }).catch(() =>
        {
            // EventSource will expose the connection status; dropped state packets are fine.
        })
    }

    onMessage(message)
    {
        if(!message || !message.type || !message.player)
            return

        if(!this.roomCode || message.roomCode !== this.roomCode)
            return

        if(message.player.id === this.playerId)
            return

        if(message.type === 'leave')
        {
            this.removeRemotePlayer(message.player.id)
            return
        }

        if(message.type === 'join' || message.type === 'presence' || message.type === 'state')
        {
            this.upsertRemotePlayer(message.player, message.state)

            if(message.type === 'join')
                this.sendMessage('presence')
        }
    }

    getLocalState()
    {
        const position = this.game.physicalVehicle.position
        const quaternion = this.game.physicalVehicle.quaternion

        return {
            position: {
                x: position.x,
                y: position.y,
                z: position.z,
            },
            quaternion: {
                x: quaternion.x,
                y: quaternion.y,
                z: quaternion.z,
                w: quaternion.w,
            },
        }
    }

    upsertRemotePlayer(remotePlayer, state)
    {
        let player = this.players.get(remotePlayer.id)
        const isNew = !player

        if(!player)
        {
            player = {
                id: remotePlayer.id,
                name: remotePlayer.name,
                local: false,
                lastSeen: this.game.ticker.elapsed,
                visual: null,
                label: null,
                targetPosition: new THREE.Vector3(),
                targetQuaternion: new THREE.Quaternion(),
            }

            this.players.set(player.id, player)
        }

        player.name = this.sanitizeName(remotePlayer.name || 'Player', true) || 'Player'
        player.lastSeen = this.game.ticker.elapsed

        if(state)
            this.setRemoteState(player, state)

        if(isNew)
            this.renderPlayers()
    }

    setRemoteState(player, state)
    {
        if(state.position)
        {
            player.targetPosition.set(
                state.position.x || 0,
                state.position.y || 0,
                state.position.z || 0
            )
        }

        if(state.quaternion)
        {
            player.targetQuaternion.set(
                state.quaternion.x || 0,
                state.quaternion.y || 0,
                state.quaternion.z || 0,
                typeof state.quaternion.w === 'number' ? state.quaternion.w : 1
            )
        }

        if(!player.visual)
            this.createRemoteVisual(player)
    }

    createRemoteVisual(player)
    {
        const chassis = this.game.world?.visualVehicle?.parts?.chassis

        if(!chassis)
            return

        player.visual = chassis.clone(true)
        player.visual.position.copy(player.targetPosition)
        player.visual.quaternion.copy(player.targetQuaternion)
        player.visual.traverse((child) =>
        {
            if(child.isMesh)
            {
                child.castShadow = true
                child.receiveShadow = true

                if(child.material)
                {
                    child.material = Array.isArray(child.material)
                        ? child.material.map(material => material.clone())
                        : child.material.clone()
                }
            }
        })
        this.game.scene.add(player.visual)

        player.label = document.createElement('div')
        player.label.classList.add('tag')
        player.label.textContent = player.name
        this.labelsElement.append(player.label)
    }

    removeRemotePlayer(playerId)
    {
        const player = this.players.get(playerId)

        if(!player || player.local)
            return

        if(player.visual)
            player.visual.removeFromParent()

        if(player.label)
            player.label.remove()

        this.players.delete(playerId)
        this.renderPlayers()
    }

    clearRemotePlayers()
    {
        for(const player of this.players.values())
        {
            if(player.local)
                continue

            if(player.visual)
                player.visual.removeFromParent()

            if(player.label)
                player.label.remove()
        }
    }

    updateRoom()
    {
        if(!this.roomCode)
            return

        if(this.game.ticker.elapsed - this.lastBroadcastTime > this.broadcastInterval)
        {
            this.lastBroadcastTime = this.game.ticker.elapsed
            this.sendMessage('state')
        }

        let needsRender = false

        for(const player of [...this.players.values()])
        {
            if(player.local)
                continue

            if(this.game.ticker.elapsed - player.lastSeen > this.remoteTimeout)
            {
                this.removeRemotePlayer(player.id)
                needsRender = true
                continue
            }

            this.updateRemoteVisual(player)
        }

        if(needsRender)
            this.renderPlayers()
    }

    updateRemoteVisual(player)
    {
        if(!player.visual)
            this.createRemoteVisual(player)

        if(!player.visual)
            return

        player.visual.position.lerp(player.targetPosition, Math.min(1, this.game.ticker.deltaScaled * 12))
        player.visual.quaternion.slerp(player.targetQuaternion, Math.min(1, this.game.ticker.deltaScaled * 12))

        if(player.label)
        {
            player.label.textContent = player.name
            this.updateRemoteLabel(player)
        }
    }

    updateRemoteLabel(player)
    {
        const position = player.visual.position.clone()
        position.y += 2.6
        position.project(this.game.view.camera)

        const isVisible = position.z > -1 && position.z < 1

        player.label.classList.toggle('is-visible', isVisible)

        if(!isVisible)
            return

        player.label.style.left = `${(position.x * 0.5 + 0.5) * 100}%`
        player.label.style.top = `${(position.y * -0.5 + 0.5) * 100}%`
    }

    renderPlayers()
    {
        this.playersElement.innerHTML = ''

        if(!this.players.size)
        {
            const emptyElement = document.createElement('div')
            emptyElement.classList.add('empty')
            emptyElement.textContent = 'No room joined.'
            this.playersElement.append(emptyElement)
            return
        }

        const players = [...this.players.values()].sort((a, b) =>
        {
            if(a.local)
                return -1
            if(b.local)
                return 1

            return a.name.localeCompare(b.name)
        })

        for(const player of players)
        {
            const element = document.createElement('div')
            element.classList.add('player')

            const nameElement = document.createElement('div')
            nameElement.classList.add('name')
            nameElement.textContent = player.name

            const badgeElement = document.createElement('div')
            badgeElement.classList.add('badge')
            badgeElement.textContent = player.local ? 'You' : 'In room'

            element.append(nameElement, badgeElement)
            this.playersElement.append(element)
        }
    }

    setStatus(message, type = '')
    {
        this.statusElement.textContent = message
        this.statusElement.classList.toggle('is-success', type === 'success')
        this.statusElement.classList.toggle('is-danger', type === 'danger')
    }

    setButtonState(button, enabled)
    {
        button.disabled = !enabled
        button.classList.toggle('is-disabled', !enabled)
    }

    update()
    {
        const hasName = !!this.getName()
        const hasRoom = !!this.roomCode
        const hasJoinCode = !!this.parseRoomCode(this.joinInput.value)

        this.setButtonState(this.createButton, hasName)
        this.setButtonState(this.joinButton, hasName && hasJoinCode)
        this.setButtonState(this.copyButton, hasRoom)
        this.setButtonState(this.leaveButton, hasRoom)

        if(!this.playersElement.children.length)
            this.renderPlayers()
    }
}
