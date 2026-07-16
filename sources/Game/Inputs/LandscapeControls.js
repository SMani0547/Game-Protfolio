export class LandscapeControls
{
    constructor(inputs)
    {
        this.inputs = inputs
        this.element = document.querySelector('.js-landscape-controls')

        this.enabled = false
        this.joystickPointerId = null
        this.joystickVector = { x: 0, y: 0 }
        this.activeKeys = new Set()
        this.activeButtons = new Map()

        if(!this.element)
            return

        this.joystickElement = this.element.querySelector('.js-landscape-joystick')
        this.stickElement = this.element.querySelector('.js-landscape-joystick-stick')
        this.buttons = [...this.element.querySelectorAll('.js-landscape-button')]

        this.setJoystick()
        this.setButtons()

        window.addEventListener('blur', () =>
        {
            this.releaseAll()
        })

        window.addEventListener('resize', () =>
        {
            if(!this.shouldBeEnabled())
                this.releaseAll()
        })
    }

    shouldBeEnabled()
    {
        if(!this.element)
            return false

        const html = document.documentElement

        if(this.inputs.mode !== 3 || !html.classList.contains('is-started'))
            return false

        if(
            html.classList.contains('input-filter-menu') ||
            html.classList.contains('input-filter-modal') ||
            html.classList.contains('input-filter-intro') ||
            html.classList.contains('input-filter-cinematic')
        )
            return false

        return window.matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 560px)').matches
    }

    setJoystick()
    {
        if(!this.joystickElement)
            return

        this.joystickElement.addEventListener('pointerdown', (event) =>
        {
            if(!this.shouldBeEnabled() || this.joystickPointerId !== null)
                return

            event.preventDefault()
            this.inputs.updateMode(3)
            this.joystickPointerId = event.pointerId
            this.joystickElement.setPointerCapture(event.pointerId)
            this.updateJoystick(event)
        })

        this.joystickElement.addEventListener('pointermove', (event) =>
        {
            if(event.pointerId !== this.joystickPointerId)
                return

            event.preventDefault()
            this.updateJoystick(event)
        })

        const end = (event) =>
        {
            if(event.pointerId !== this.joystickPointerId)
                return

            event.preventDefault()
            this.joystickPointerId = null
            this.resetJoystick()
        }

        this.joystickElement.addEventListener('pointerup', end)
        this.joystickElement.addEventListener('pointercancel', end)
    }

    setButtons()
    {
        const keyByAction = {
            boost: 'Touch.boost',
            brake: 'Touch.brake',
            suspensions: 'Touch.suspensions',
            interact: 'Touch.interact',
            honk: 'Touch.honk',
            respawn: 'Touch.respawn',
            camera: 'Touch.camera',
        }

        for(const button of this.buttons)
        {
            const action = button.dataset.action
            const key = keyByAction[action]

            if(!key)
                continue

            button.addEventListener('pointerdown', (event) =>
            {
                if(!this.shouldBeEnabled())
                    return

                event.preventDefault()
                this.inputs.updateMode(3)
                button.setPointerCapture(event.pointerId)
                this.activeButtons.set(event.pointerId, { button, key })
                this.pressKey(key)
                button.classList.add('is-pressed')
            })

            const end = (event) =>
            {
                const activeButton = this.activeButtons.get(event.pointerId)

                if(!activeButton)
                    return

                event.preventDefault()
                this.activeButtons.delete(event.pointerId)
                this.releaseKey(activeButton.key)
                activeButton.button.classList.remove('is-pressed')
            }

            button.addEventListener('pointerup', end)
            button.addEventListener('pointercancel', end)
        }
    }

    updateJoystick(event)
    {
        const rect = this.joystickElement.getBoundingClientRect()
        const centerX = rect.left + rect.width * 0.5
        const centerY = rect.top + rect.height * 0.5
        const maxRadius = Math.min(rect.width, rect.height) * 0.34

        let x = (event.clientX - centerX) / maxRadius
        let y = (event.clientY - centerY) / maxRadius
        const radius = Math.hypot(x, y)

        if(radius > 1)
        {
            x /= radius
            y /= radius
        }

        this.joystickVector.x = x
        this.joystickVector.y = y

        this.stickElement.style.transform = `translate(${x * maxRadius}px, ${y * maxRadius}px)`
        this.updateJoystickKeys()
    }

    resetJoystick()
    {
        this.joystickVector.x = 0
        this.joystickVector.y = 0

        if(this.stickElement)
            this.stickElement.style.transform = ''

        this.releaseKey('Touch.forward')
        this.releaseKey('Touch.backward')
        this.releaseKey('Touch.left')
        this.releaseKey('Touch.right')
    }

    updateJoystickKeys()
    {
        const deadZone = 0.16
        const x = this.joystickVector.x
        const y = this.joystickVector.y

        this.setAnalogKey('Touch.forward', y < -deadZone, Math.abs(y))
        this.setAnalogKey('Touch.backward', y > deadZone, Math.abs(y))
        this.setAnalogKey('Touch.left', x < -deadZone, Math.abs(x))
        this.setAnalogKey('Touch.right', x > deadZone, Math.abs(x))
    }

    setAnalogKey(key, active, value)
    {
        if(active)
            this.pressKey(key, value)
        else
            this.releaseKey(key)
    }

    pressKey(key, value = 1)
    {
        if(!this.activeKeys.has(key))
            this.activeKeys.add(key)

        this.inputs.start(key, value)
    }

    releaseKey(key)
    {
        if(!this.activeKeys.has(key))
            return

        this.activeKeys.delete(key)
        this.inputs.end(key)
    }

    releaseAll()
    {
        this.joystickPointerId = null
        this.resetJoystick()

        for(const { button, key } of this.activeButtons.values())
        {
            this.releaseKey(key)
            button.classList.remove('is-pressed')
        }

        this.activeButtons.clear()
    }

    update()
    {
        const enabled = this.shouldBeEnabled()

        if(this.enabled && !enabled)
            this.releaseAll()

        document.documentElement.classList.toggle('is-landscape-controls', enabled)

        if(enabled)
        {
            this.inputs.interactiveButtons.deactivate()
            this.inputs.nipple.cancel()
        }
        else if(this.enabled && this.inputs.mode === 3)
        {
            this.inputs.interactiveButtons.activate()
        }

        this.enabled = enabled
    }
}
