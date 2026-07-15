import * as THREE from 'three/webgpu'
import { color, float, Fn, instancedArray, max, mix, positionGeometry, sin, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { Inputs } from '../../Inputs/Inputs.js'
import { InteractivePoints } from '../../InteractivePoints.js'
import { Area } from './Area.js'
import gsap from 'gsap'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { TextCanvas } from '../../TextCanvas.js'

export class LandingArea extends Area
{
    constructor(model)
    {
        super(model)

        this.localTime = uniform(0)

        this.setLetters()
        this.setNameHologram()
        this.setKiosk()
        this.setControls()
        this.setBonfire()
        this.setAchievement()
    }

    setLetters()
    {
        const references = this.references.items.get('letters') ?? []

        this.letters = {}
        this.letters.references = references
        this.letters.hidden = false

        for(const reference of references)
        {
            const physical = reference.userData.object?.physical
            if(!physical?.colliders?.[0])
                continue

            physical.colliders[0].setActiveEvents(this.game.RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            physical.colliders[0].setContactForceEventThreshold(5)
            physical.onCollision = (force, position) =>
            {
                this.game.audio.groups.get('hitBrick').playRandomNext(force, position)
            }
        }
    }

    setNameHologram()
    {
        this.nameHologram = {}
        this.nameHologram.revealed = false
        this.nameHologram.baseOpacity = uniform(0)
        this.nameHologram.beamOpacity = uniform(0)
        this.nameHologram.textOpacity = uniform(0)
        this.nameHologram.lookTarget = new THREE.Vector3()
        this.nameHologram.textWorldPosition = new THREE.Vector3()
        this.nameHologram.anchor = new THREE.Vector3()
        this.nameHologram.items = []
        this.nameHologram.name = 'SHIVA MANI GOUNDAR'
        this.nameHologram.baseY = 0
        this.nameHologram.characterSpacing = 0.78
        this.nameHologram.spaceSpacing = 0.62
        this.nameHologram.rotationY = -2.705

        const box = new THREE.Box3()

        for(const reference of this.letters.references)
        {
            reference.updateWorldMatrix(true, true)
            box.expandByObject(reference)
        }

        // Keep the hologram on the old full-name footprint even after the GLB
        // letters are removed in Blender.
        this.nameHologram.anchor.set(
            this.model.position.x - 5.210609436035156,
            0,
            this.model.position.z + 3.0861968994140625
        )

        // The bounding-zone helper floats above the floor, so when the old GLB
        // letters are removed we anchor the hologram to the landing tile height.
        const landingGroundY = this.model.position.y - 3.23
        this.nameHologram.baseY = box.isEmpty() ? landingGroundY + 0.04 : Math.min(box.min.y + 0.04, landingGroundY + 0.04)
        this.nameHologram.anchor.y = this.nameHologram.baseY

        this.nameHologram.group = new THREE.Group()
        this.nameHologram.group.visible = false
        this.nameHologram.group.position.copy(this.nameHologram.anchor)
        this.nameHologram.group.rotation.y = this.nameHologram.rotationY
        this.nameHologram.group.scale.set(0.7, 0.05, 0.7)
        this.game.scene.add(this.nameHologram.group)
        this.objects.hideable.push(this.nameHologram.group)

        const padMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
        padMaterial.fog = false
        padMaterial.outputNode = Fn(() =>
        {
            const baseUv = uv().sub(0.5).mul(2)
            const distanceToCenter = baseUv.length()
            const pulse = sin(this.localTime.mul(2.2)).mul(0.12).add(0.88)
            const alpha = max(0, float(1).sub(distanceToCenter.mul(1.25))).mul(this.nameHologram.baseOpacity)
            const finalColor = color('#61edff').mul(pulse)

            return vec4(finalColor.mul(alpha.mul(1.8).add(0.25)), alpha.mul(0.75))
        })()

        const beamMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
        beamMaterial.fog = false
        beamMaterial.outputNode = Fn(() =>
        {
            const baseUv = uv()
            const horizontalFade = max(0, float(1).sub(baseUv.x.sub(0.5).abs().mul(2)))
            const verticalFade = baseUv.y.oneMinus().mul(0.8).add(0.2)
            const scan = texture(
                this.game.noises.perlin,
                vec2(baseUv.x.mul(0.4).add(0.15), baseUv.y.mul(0.4).sub(this.localTime.mul(0.05)))
            ).r.mul(0.25).add(0.75)

            const alpha = horizontalFade.mul(verticalFade).mul(scan).mul(this.nameHologram.beamOpacity)
            const finalColor = mix(color('#7bf3ff'), color('#128fff'), baseUv.y)

            return vec4(finalColor.mul(alpha.mul(1.4).add(0.3)), alpha.mul(0.5))
        })()

        const panelMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
        panelMaterial.fog = false
        panelMaterial.outputNode = Fn(() =>
        {
            const baseUv = uv()
            const centeredUv = baseUv.sub(0.5).abs().mul(2)
            const edge = max(centeredUv.x, centeredUv.y)
            const border = step(0.86, edge).mul(0.9)
            const fill = max(0, float(1).sub(edge.mul(0.9))).mul(0.28)
            const scan = texture(
                this.game.noises.perlin,
                vec2(baseUv.x.mul(0.3), baseUv.y.mul(0.6).sub(this.localTime.mul(0.045)))
            ).r.mul(0.16).add(0.84)
            const alpha = border.add(fill).mul(scan).mul(this.nameHologram.beamOpacity)
            const finalColor = mix(color('#c9fbff'), color('#3deaff'), baseUv.y)

            return vec4(finalColor.mul(alpha.mul(1.7).add(0.45)), alpha.mul(0.8))
        })()

        const createTextMaterial = (textCanvas, delay) =>
        {
            const material = new THREE.MeshBasicNodeMaterial({
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            })
            material.fog = false
            material.outputNode = Fn(() =>
            {
                const baseUv = uv()
                const maskUv = vec2(baseUv.x.oneMinus(), baseUv.y.oneMinus())
                const mask = texture(textCanvas.texture, maskUv).r
                const scan = texture(
                    this.game.noises.perlin,
                    vec2(baseUv.y.mul(0.2), baseUv.x.mul(1.25).sub(this.localTime.mul(0.08)).add(delay))
                ).r.mul(0.35).add(0.65)
                const alpha = step(0.1, mask).mul(this.nameHologram.textOpacity).mul(scan)
                const finalColor = mix(color('#9df8ff'), color('#128fff'), baseUv.y)

                return vec4(finalColor.mul(alpha.mul(2).add(0.65)), alpha)
            })()
            material.positionNode = Fn(() =>
            {
                const baseUv = uv()
                const newPosition = positionGeometry.toVar()
                newPosition.x.addAssign(sin(this.localTime.mul(1.3).add(baseUv.y.mul(12)).add(delay)).mul(0.025).mul(baseUv.y))
                newPosition.y.addAssign(sin(this.localTime.mul(1.6).add(baseUv.x.mul(10)).add(delay)).mul(0.014))
                return newPosition
            })()

            return material
        }

        const padGeometry = new THREE.CircleGeometry(0.36, 32)
        const ringGeometry = new THREE.TorusGeometry(0.39, 0.022, 8, 40)
        const coneGeometry = new THREE.ConeGeometry(0.31, 0.9, 22, 1, true)
        coneGeometry.translate(0, 0.45, 0)
        const panelGeometry = new THREE.PlaneGeometry(0.72, 1.32)
        const textGeometry = new THREE.PlaneGeometry(0.64, 0.98)
        const ringMaterial = this.game.materials.getFromName('emissiveBlueRadialGradient')

        const placements = []
        let cursor = 0

        for(const character of [...this.nameHologram.name])
        {
            const spacing = character === ' ' ? this.nameHologram.spaceSpacing : this.nameHologram.characterSpacing

            if(character !== ' ')
            {
                placements.push({
                    character,
                    x: cursor + spacing * 0.5,
                })
            }

            cursor += spacing
        }

        const offsetX = cursor * -0.5

        for(const [index, placement] of placements.entries())
        {
            const item = {}
            item.index = index
            item.group = new THREE.Group()
            item.group.position.set(-(placement.x + offsetX), 0, 0)
            item.group.scale.set(0.55, 0.05, 0.55)
            this.nameHologram.group.add(item.group)

            item.pad = new THREE.Mesh(padGeometry, padMaterial)
            item.pad.rotation.x = -Math.PI * 0.5
            item.pad.position.y = 0.01
            item.pad.renderOrder = 20
            item.group.add(item.pad)

            item.ring = new THREE.Mesh(ringGeometry, ringMaterial)
            item.ring.rotation.x = Math.PI * 0.5
            item.ring.renderOrder = 21
            item.group.add(item.ring)

            item.beam = new THREE.Mesh(coneGeometry, beamMaterial)
            item.beam.scale.y = 0.01
            item.beam.renderOrder = 22
            item.group.add(item.beam)

            item.textGroup = new THREE.Group()
            item.textGroup.position.y = 0.25
            item.group.add(item.textGroup)

            item.panel = new THREE.Mesh(panelGeometry, panelMaterial)
            item.panel.position.y = 1.04
            item.panel.castShadow = false
            item.panel.receiveShadow = false
            item.panel.renderOrder = 29
            item.textGroup.add(item.panel)

            item.textCanvas = new TextCanvas('Pally-Medium', '500', 212, 360, 360, 1, 'center', 180)
            item.updateText = () =>
            {
                item.textCanvas.updateText(placement.character)
            }
            item.updateText()

            item.textMesh = new THREE.Mesh(textGeometry, createTextMaterial(item.textCanvas, float(index * 0.37)))
            item.textMesh.position.y = 1.04
            item.textMesh.rotation.y = Math.PI
            item.textMesh.castShadow = false
            item.textMesh.receiveShadow = false
            item.textMesh.renderOrder = 30
            item.textGroup.add(item.textMesh)

            this.nameHologram.items.push(item)
        }

        document.fonts?.ready?.then(() =>
        {
            for(const item of this.nameHologram.items)
                item.updateText()
        })

        this.nameHologram.show = () =>
        {
            if(this.nameHologram.revealed)
                return

            this.nameHologram.revealed = true

            this.nameHologram.group.visible = true
            this.nameHologram.group.position.y = this.nameHologram.baseY - 0.05
            this.nameHologram.group.rotation.y = this.nameHologram.rotationY
            this.nameHologram.group.scale.set(0.7, 0.05, 0.7)

            gsap.to(this.nameHologram.baseOpacity, { value: 1, duration: 0.75, ease: 'power2.out', overwrite: true })
            gsap.to(this.nameHologram.beamOpacity, { value: 1, duration: 0.95, ease: 'power2.out', overwrite: true })
            gsap.to(this.nameHologram.textOpacity, { value: 1, duration: 1.1, delay: 0.2, ease: 'power2.out', overwrite: true })
            gsap.to(this.nameHologram.group.position, { y: this.nameHologram.baseY, duration: 1.2, ease: 'power2.out', overwrite: true })
            gsap.to(this.nameHologram.group.scale, { x: 1, y: 1, z: 1, duration: 1.25, ease: 'back.out(1.8)', overwrite: true })

            for(const item of this.nameHologram.items)
            {
                const delay = 0.03 * item.index

                item.group.scale.set(0.55, 0.05, 0.55)
                item.textGroup.position.y = 0.25
                item.beam.scale.y = 0.01

                gsap.to(item.group.scale, { x: 1, y: 1, z: 1, duration: 0.85, delay, ease: 'back.out(1.9)', overwrite: true })
                gsap.to(item.textGroup.position, { y: 0.52, duration: 0.9, delay, ease: 'power2.out', overwrite: true })
                gsap.to(item.beam.scale, { y: 1, duration: 0.8, delay, ease: 'power2.out', overwrite: true })
            }
        }
    }

    setKiosk()
    {
        // Interactive point
        const interactivePoint = this.game.interactivePoints.create(
            this.references.items.get('kioskInteractivePoint')[0].position,
            'Map',
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.game.inputs.interactiveButtons.clearItems()
                this.game.modals.open('map')
                // interactivePoint.hide()
            },
            () =>
            {
                this.game.inputs.interactiveButtons.addItems(['interact'])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems(['interact'])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems(['interact'])
            }
        )

        // this.game.map.items.get('map').events.on('close', () =>
        // {
        //     interactivePoint.show()
        // })
    }

    setControls()
    {
        // Interactive point
        const interactivePoint = this.game.interactivePoints.create(
            this.references.items.get('controlsInteractivePoint')[0].position,
            'Controls',
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.game.inputs.interactiveButtons.clearItems()
                this.game.menu.open('controls')
                interactivePoint.hide()
            },
            () =>
            {
                this.game.inputs.interactiveButtons.addItems(['interact'])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems(['interact'])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems(['interact'])
            }
        )

        // Menu instance
        const menuInstance = this.game.menu.items.get('controls')

        menuInstance.events.on('close', () =>
        {
            interactivePoint.show()
        })

        menuInstance.events.on('open', () =>
        {
            if(this.game.inputs.mode === Inputs.MODE_GAMEPAD)
                menuInstance.tabs.goTo('gamepad')
            else if(this.game.inputs.mode === Inputs.MODE_MOUSEKEYBOARD)
                menuInstance.tabs.goTo('mouse-keyboard')
            else if(this.game.inputs.mode === Inputs.MODE_TOUCH)
                menuInstance.tabs.goTo('touch')
        })
    }

    setBonfire()
    {
        const position = this.references.items.get('bonfireHashes')[0].position

        // Particles
        let particles = null
        {
            const emissiveMaterial = this.game.materials.getFromName('emissiveOrangeRadialGradient')
    
            const count = 30
            const elevation = uniform(5)
            const positions = new Float32Array(count * 3)
            const scales = new Float32Array(count)
    
    
            for(let i = 0; i < count; i++)
            {
                const i3 = i * 3
    
                const angle = Math.PI * 2 * Math.random()
                const radius = Math.pow(Math.random(), 1.5) * 1
                positions[i3 + 0] = Math.cos(angle) * radius
                positions[i3 + 1] = Math.random()
                positions[i3 + 2] = Math.sin(angle) * radius
    
                scales[i] = 0.02 + Math.random() * 0.06
            }
            
            const positionAttribute = instancedArray(positions, 'vec3').toAttribute()
            const scaleAttribute = instancedArray(scales, 'float').toAttribute()
    
            const material = new THREE.SpriteNodeMaterial()
            material.outputNode = emissiveMaterial.outputNode
    
            const progress = float(0).toVar()
    
            material.positionNode = Fn(() =>
            {
                const newPosition = positionAttribute.toVar()
                progress.assign(newPosition.y.add(this.localTime.mul(newPosition.y)).fract())
    
                newPosition.y.assign(progress.mul(elevation))
                newPosition.xz.addAssign(this.game.wind.direction.mul(progress))
    
                const progressHide = step(0.8, progress).mul(100)
                newPosition.y.addAssign(progressHide)
                
                return newPosition
            })()
            material.scaleNode = Fn(() =>
            {
                const progressScale = progress.remapClamp(0.5, 1, 1, 0)
                return scaleAttribute.mul(progressScale)
            })()
    
            const geometry = new THREE.CircleGeometry(0.5, 8)
    
            particles = new THREE.Mesh(geometry, material)
            particles.visible = false
            particles.position.copy(position)
            particles.count = count
            this.game.scene.add(particles)
        }

        // Hashes
        {
            const alphaNode = Fn(() =>
            {
                const baseUv = uv(1)
                const distanceToCenter = baseUv.sub(0.5).length()
    
                const voronoi = texture(
                    this.game.noises.voronoi,
                    baseUv
                ).g
    
                voronoi.subAssign(distanceToCenter.remap(0, 0.5, 0.3, 0))
    
                return voronoi
            })()
    
            const material = new MeshDefaultMaterial({
                colorNode: color(0x6F6A87),
                alphaNode: alphaNode,
                hasWater: false,
                hasLightBounce: false
            })
    
            const mesh = this.references.items.get('bonfireHashes')[0]
            mesh.material = material
        }

        // Burn
        const burn = this.references.items.get('bonfireBurn')[0]
        burn.visible = false

        // Interactive point
        this.game.interactivePoints.create(
            this.references.items.get('bonfireInteractivePoint')[0].position,
            'Res(e)t',
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.game.reset()

                gsap.delayedCall(2, () =>
                {
                    // Bonfire
                    particles.visible = true
                    burn.visible = true
                    this.game.ticker.wait(2, () =>
                    {
                        particles.geometry.boundingSphere.center.y = 2
                        particles.geometry.boundingSphere.radius = 2
                    })

                    // Sound
                    this.game.audio.groups.get('campfire').items[0].positions.push(position)
                })
            },
            () =>
            {
                this.game.inputs.interactiveButtons.addItems(['interact'])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems(['interact'])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems(['interact'])
            }
        )
    }

    setAchievement()
    {
        this.events.on('boundingIn', () =>
        {
            this.game.achievements.setProgress('areas', 'landing')
        })
        this.events.on('boundingOut', () =>
        {
            this.game.achievements.setProgress('landingLeave', 1)
        })
    }

    update()
    {
        this.localTime.value += this.game.ticker.deltaScaled * 0.1

        if(this.nameHologram)
        {
            if(!this.nameHologram.revealed && this.game.reveal.step === 2)
                this.nameHologram.show()

            if(this.nameHologram.group.visible)
            {
                this.nameHologram.lookTarget.copy(this.game.view.camera.position)

                for(const item of this.nameHologram.items)
                {
                    item.ring.rotation.z = this.localTime.value * (0.14 + item.index * 0.002)
                    item.textGroup.position.y = 0.52 + Math.sin(this.game.ticker.elapsedScaled * 0.7 + item.index * 0.24) * 0.04

                    this.nameHologram.lookTarget.y = item.textGroup.getWorldPosition(this.nameHologram.textWorldPosition).y
                    item.textGroup.lookAt(this.nameHologram.lookTarget)
                }
            }
        }
    }
}
