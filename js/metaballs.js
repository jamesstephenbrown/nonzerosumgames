const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

canvas.width = innerWidth
canvas.height = innerHeight
centre = {x: innerWidth/2, y:innerHeight/2}
ballCount = 20
closestBall = null
mouseIsDown = false
mousePosition = {x:0,y:0}

const balls = []

class Ball {
	constructor (position, radius, index) {
		this.x = position.x
		this.y = position.y
		this.radius = radius
		this.offset = 0
		this.offsetRadius = radius
		this.contacts = []
		this.contactPoints = []
		this.index = index

		console.log(index);
	}
	draw () {
		c.beginPath()
		c.arc(this.x, this.y, this.offsetRadius, 0, Math.PI * 2, false)
		c.fillStyle = 'grey'
		c.fill()
		c.closePath()

		c.beginPath()
		for (var i = this.contactPoints.length - 1; i >= 0; i--) {
			const points = this.contactPoints[i]
			c.moveTo(points[0].x,points[0].y)
			c.quadraticCurveTo(points[1].x, points[1].y, points[2].x, points[2].y)
			c.lineTo(points[3].x, points[3].y)
			c.quadraticCurveTo(points[4].x, points[4].y, points[5].x, points[5].y)
			c.lineTo(points[0].x, points[0].y)
		}
		c.fillStyle = 'grey'
		c.fill()
		c.closePath()
	}
	findContacts () {
		for (var i = balls.length - 1; i >= 0; i--) {
			const heading = {x: this.x - balls[i].x, y: this.y - balls[i].y}
			const distance = Math.hypot(heading.x,heading.y)
			if (this.index > balls[i].index) { // avoids duplication of metaUpdate calculations and avoids self
				if (!this.contacts.includes(balls[i]) && distance <= this.offsetRadius + balls[i].radius) {
					this.contacts.push(balls[i])
				}
			}
		}
		for (var i = this.contacts.length - 1; i >= 0; i--) {
			const heading = {x: this.x - this.contacts[i].x, y: this.y - this.contacts[i].y}
			const distance = Math.hypot(heading.x,heading.y)
			if (distance > this.offsetRadius * 2.5 + this.contacts[i].offsetRadius * 2.5) {
				// this.offsetRadius = this.radius
				// this.contacts[i].offsetRadius = this.contacts[i].radius
				this.contacts.splice(i,1)
			} else if (distance <= this.radius + this.contacts[i].radius) {
				const touchDistance = this.radius + this.contacts[i].radius
				const multiplier = (touchDistance - distance) / touchDistance;

				const contactVolume = Math.PI*(this.contacts[i].radius*this.contacts[i].radius)
				const thisVolume = Math.PI*(this.radius*this.radius)
				const combinedVolume = contactVolume + thisVolume
				const combinedVolumeRadius = Math.sqrt(combinedVolume/Math.PI)

				// we set for both in the pair because the other does not process this part
				this.offset += multiplier*multiplier * (combinedVolumeRadius - this.radius) // this doesn't take into account if the offset radius is already increased by contact with another
				this.contacts[i].offset += multiplier*multiplier * (combinedVolumeRadius - this.contacts[i].radius)
			}
		}
	}
	update () {
		this.draw()
	}
	
	metaUpdate () {
		// clearing contact points array
		this.contactPoints = []
		this.contacts.forEach((ball) => {
			const points = []
			const heading = {x: this.x - ball.x, y: this.y - ball.y}
			const distance = Math.hypot(heading.x,heading.y)

			if (distance > 10) {
				this.x -= (1/distance + 1) * ball.offsetRadius * heading.x / (distance *100)
				this.y -= (1/distance + 1) * ball.offsetRadius * heading.y / (distance *100)
				ball.x += (1/distance + 1) * this.offsetRadius * heading.x / (distance *100)
				ball.y += (1/distance + 1) * this.offsetRadius * heading.y / (distance *100)
			}

			const averageRadius = ((this.offsetRadius + ball.offsetRadius) / 2)
			const maxDist = (this.offsetRadius + ball.offsetRadius) * 1.8
			// Work out aMid first!
			const aMidX = (this.offsetRadius / (this.offsetRadius+ball.offsetRadius)) * distance
			const aMidY = (averageRadius) - ((distance/maxDist) * (averageRadius))

			const startHypot = Math.sqrt(aMidX * aMidX + averageRadius * averageRadius)
			// aStart
			const aStartX = (this.offsetRadius / startHypot) * aMidX
			const aStartY = (this.offsetRadius / startHypot) * averageRadius
			// aEnd
			const endDist = (distance - aMidX)
			const endHypot = Math.sqrt(endDist * endDist + averageRadius * averageRadius)

			const aEndX = distance - ((ball.offsetRadius / endHypot) * endDist)
			const aEndY = ((ball.offsetRadius / endHypot) * averageRadius)
			// add points
			points[0] = ( { x: aStartX + this.x, y: aStartY + this.y } )
			points[1] = ( { x: aMidX + this.x, y: aMidY + this.y } )
			points[2] = ( { x: aEndX + this.x, y: aEndY + this.y } )
			points[3] = ( { x: aEndX + this.x, y: -aEndY + this.y } ) // y coordinates are reversed for bottom x coordinates are the same
			points[4] = ( { x: aMidX + this.x, y: -aMidY + this.y } )
			points[5] = ( { x: aStartX + this.x, y: -aStartY + this.y } )

			points.forEach((point) => {
				point.x = (rotatedPoint(point,heading,this)).x
				point.y = (rotatedPoint(point,heading,this)).y
			})
			this.contactPoints.push(points)
		})
	}
}
addEventListener('mousedown', (event) => {
	mouseIsDown = true
// setting up closest ball
	closestBall = null
	closestDist = 1000
	balls.forEach((ball) => {
		let heading = {x: event.clientX - ball.x, y: event.clientY - ball.y}
		const distance = Math.hypot(heading.x,heading.y)
		if (distance < closestDist) {
			closestBall = ball
			closestDist = distance
		}
	})
	mousePosition.x = event.clientX
	mousePosition.y = event.clientY
})
addEventListener('mousemove', (event) => {
	mousePosition.x = event.clientX
	mousePosition.y = event.clientY
})
addEventListener('mouseup', (event) => {
	mouseIsDown = false
	closestBall = null
})
let debugFrame = false
document.addEventListener('keydown', function(event){
	debugFrame = true
})

function findPosition() {
	let position = {
		x:centre.x + (Math.floor(Math.random()*10)*60) - 300,
		y:centre.y + (Math.floor(Math.random()*10)*60) - 300
	}
	balls.forEach((ball) => {
		if (ball.x == position.x && ball.y == position.y) {
			position = findPosition()
		}
	})
	return position
}
function init () {
	for (var i = ballCount - 1; i >= 0; i--) {
			v = i
		balls.push(new Ball(
			findPosition(),Math.random() * (50 - 20 + 1) + 20, v
			)
		)
	}
	closestBall = balls[0]
}
function animate() {
	requestAnimationFrame(animate)
	c.fillStyle = 'rgba(50,50,50,1)'
	c.fillRect(0,0,canvas.width,canvas.height)

	balls.forEach((ball) => {
		ball.offset = 0
	})
	balls.forEach((ball) => {
		ball.findContacts()
	})
	balls.forEach((ball) => {
		ball.offsetRadius = ball.radius + ball.offset
	})
	if (mouseIsDown && closestBall) {
		closestBall.x = mousePosition.x
		closestBall.y = mousePosition.y
	}
	balls.forEach((ball) => {
		ball.metaUpdate()
	})
	balls.forEach((ball) => {
		ball.update()
	})
	if (debugFrame) {
		for (var i = closestBall.contacts.length - 1; i >= 0; i--) {
			console.log (closestBall.contacts[i].index + "\n")
		}
	}
	debugFrame = false;

}
init()
animate()

function getVectorAngle (heading) {

	const x = heading.x
	const y = heading.y
	const angle = (((Math.acos(y / Math.sqrt(x * x + y * y)) * (Math.sign(x) || 1)) * 180 / Math.PI) + 360) % 360
	return ((-angle-90) / 2)
}
function rotatedPoint (position, heading, point) {
	const angleDegrees = getVectorAngle(heading)

	let angleRadians = angleDegrees * Math.PI / 180; // sin + cos require radians

	const x =
	point.x +
	(position.x - point.x) * Math.cos(angleRadians) -
	(position.y - point.y) * Math.sin(angleRadians)

	const y =
	point.y +
	(position.x - point.x) * Math.sin(angleRadians) +
	(position.y - point.y) * Math.cos(angleRadians)

	position.x = x;  // move the rotated shape in relation to the rotation point.
	position.y = y;

	return {x: position.x, y: position.y}

}