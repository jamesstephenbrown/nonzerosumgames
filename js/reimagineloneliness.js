canvas = document.querySelector('canvas')
c = canvas.getContext('2d')

canvas.width = innerWidth - 30 // to avoid scroll bar
canvas.height = 1000
centre = {x: canvas.width/2, y:canvas.height/2}
ballCount = 20
closestBall = null
mouseIsDown = false
mousePosition = {x:0,y:0}
balls = []
vacinity = 100

class Dot {
	constructor (position, radius, index) {
		this.x = position.x
		this.y = position.y
		this.goal = {x:this.x,y:this.y}
		this.index = index
		this.radius = radius

		console.log(this.index, this.x, this.y)
	}
	draw () {
		c.beginPath()
		c.arc(this.x, this.y, this.radius, Math.PI * 2, false)
		c.fillStyle = 'black'
		c.fill()
		c.closePath()
	}
}

class Player extends Dot {
	follow () {
		// follow mouse position at a restricted speed

		if (mouseIsDown) {
			this.goal.x = mousePosition.x
			this.goal.y = mousePosition.y
			console.log("Player")

			var heading = {x: this.goal.x - this.x, y: this.goal.y - this.y}
			this.x += heading.x / 10
			this.y += heading.y / 10
		}
	}
	update () {
		this.follow()
		this.collision()
		this.draw()
	}

	collision() {

	}

}

player = new Player({x:centre.x,y: -20}, 15, -1);

class Ball extends Dot {
	react () {

		var random = Math.floor(Math.random()*(ballCount-1))

		var runFromIndex = this.index < ballCount - 10 ? this.index + 10 : this.index - (ballCount) + 10
		var index = this.index < ballCount - 1 ? this.index + 1 : this.index - (ballCount) + 1
		var index2 = this.index < ballCount - random ? this.index + random : this.index - (ballCount) + random

		var heading = {x: balls[index].x - this.x, y: balls[index].y - this.y}
		var heading2 = {x: balls[index2].x - this.x, y: balls[index2].y - this.y}
		var runFromHeading = {x: balls[runFromIndex].x - this.x, y: balls[runFromIndex].y - this.y}
		var distance = Math.hypot(runFromHeading.x,runFromHeading.y)
		this.x += heading.x / 50
		this.y += heading.y / 50
		this.x += heading2.x / 500
		this.y += heading2.y / 500
		this.x -= runFromHeading.x / (distance * 10)
		this.y -= runFromHeading.y / (distance * 10)

		// for a random index go towards until you get within a certain distance
		// each 5 seconds switch to a new friend
		// if the player comes within your vacinity move away from player with twice the intensity of staying together
		// avoid edge
	}
	update () {
		this.react()
		this.collision ()
		this.draw()
	}
	collision () {

		balls.forEach((ball) => {
			if (ball != this) {
				var heading = {x: (ball.x - this.x), y:(ball.y - this.y)}
				var distance = Math.hypot(heading.x,heading.y)
				this.x -= 10*heading.x/(distance*distance)
				this.y -= 10*heading.y/(distance*distance)
			}
		})

		var head = {x: (player.x - this.x), y:(player.y - this.y)}
		var dist = Math.hypot(head.x,head.y)
		if (dist < vacinity) {
			this.x -= (10*head.x)/(dist)
			this.y -= (10*head.y)/(dist)
		}
		// all balls cannot go over edge
		// all balls collide with each other if they get closer than
		// all balls slow down if they are near a collider?
	}
}

addEventListener('mousedown', (event) => {
	mouseIsDown = true
// setting up closest ball
	// closestBall = null
	// closestDist = 1000
	// balls.forEach((ball) => {
	// 	let heading = {x: event.clientX - ball.x, y: event.clientY - ball.y}
	// 	const distance = Math.hypot(heading.x,heading.y)
	// 	if (distance < closestDist) {
	// 		closestBall = ball
	// 		closestDist = distance
	// 	}
	// })
	var rect = canvas.getBoundingClientRect()
	mousePosition.x = event.clientX - rect.left
	mousePosition.y = event.clientY - rect.top
})
addEventListener('mousemove', (event) => {
	// mousePosition.x = event.clientX
	// mousePosition.y = event.clientY
	var rect = canvas.getBoundingClientRect()
	mousePosition.x = event.clientX - rect.left
	mousePosition.y = event.clientY - rect.top
})
addEventListener('mouseup', (event) => {
	mouseIsDown = false
	closestBall = null
})
// let debugFrame = false
// document.addEventListener('keydown', function(event){
// 	debugFrame = true
// })

function findPosition() {
	let position = {
		x:centre.x + (Math.floor(Math.random()*9)*(canvas.width/10)) - canvas.width / 2.2,
		y:centre.y + (Math.floor(Math.random()*9)*(canvas.height/10)) - canvas.height / 2.2
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
			findPosition(),Math.random() * (5) + 10, v
			)
		)
	}

	closestBall = balls[0]
}
function animate() {
	requestAnimationFrame(animate)
	c.fillStyle = '#799'
	c.fillRect(0,0,canvas.width,canvas.height)

	player.follow()
	player.draw()
	player.collision()

	balls.forEach((ball) => {
		ball.react()
		ball.draw()
		ball.collision()
	})
}
init()
animate()