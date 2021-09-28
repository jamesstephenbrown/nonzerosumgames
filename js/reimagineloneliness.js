canvas = document.querySelector('canvas')
c = canvas.getContext('2d')

canvas.width = innerWidth - 30 // to avoid scroll bar
canvas.height = 1000
centre = {x: canvas.width/2, y:canvas.height/2}
ballCount = 40
mouseIsDown = false
mousePosition = {x:0,y:0}
balls = []
vacinity = 200
maxSpeed = 2


// canvas.addEventListener("touchstart", (event) => {

// 	event.preventDefault()
// 	mouseIsDown = true
// 	var rect = canvas.getBoundingClientRect()
// 	mousePosition.x = event.clientX - rect.left
// 	mousePosition.y = event.clientY - rect.top
// })
// canvas.addEventListener("touchmove", (event) => {

// 	event.preventDefault()
// 	var rect = canvas.getBoundingClientRect()
// 	mousePosition.x = event.clientX - rect.left
// 	mousePosition.y = event.clientY - rect.top
// })
// canvas.addEventListener("touchend", (event) => {

// 	event.preventDefault()
// 	mouseIsDown = false
// })
// canvas.addEventListener("touchcancel", (event) => {

// 	event.preventDefault()
// 	mouseIsDown = false
// })

canvas.addEventListener("touchstart", touchDown, false);
canvas.addEventListener("touchmove", touchMoved, false);
canvas.addEventListener("touchend", touchUp, false);
canvas.addEventListener("touchcancel", touchUp, false);

function touchDown(evt) {
    evt.preventDefault();

    // Ignore touches after the first.
    if (activeTouch != null)
        return;

    if (evt.changedTouches.length > 0) {
        activeTouch = evt.changedTouches[0].identifier;
        mousePosition = getTouchPos(evt);
    }
}

function touchUp(evt)  {
    mousePosition = getTouchPos(evt);
    activeTouch = null;
}

function touchMoved(evt)  {
    mousePosition = getTouchPos(evt);
}

function getTouchPos(evt)  {
    var canX = 0;
    var canY = 0;

    for( var i = 0; i < evt.touches.length; i++ ) {
        if (evt.touches[i].identifier == activeTouch) {
            canX = evt.touches[i].pageX - c.offsetLeft;
            canY = evt.touches[i].pageY - c.offsetTop;
            break;
        }
    }
    return { 'x': canX, 'y': canY }
}



class Dot {
	constructor (position, radius, index) {
		this.x = position.x
		this.y = position.y
		this.goal = {x:this.x,y:this.y}
		this.index = index
		this.radius = radius
		this.timer = 0
		this.timeLimit = Math.floor(Math.random()*(1000)+500)
		this.otherIndex = Math.floor(Math.random()*(ballCount-1))
		this.scared = false

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
}
player = new Player({x:centre.x,y: 20}, 15, -1);

class Ball extends Dot {

	react () {
		this.goal.x = this.x
		this.goal.y = this.y

		var head = {x: (player.x - this.x), y:(player.y - this.y)}
		var dist = Math.hypot(head.x,head.y)

		if (dist < vacinity) {
			this.scared = true;
		}
		this.timer += 1

		if (this.timer > this.timeLimit) {

			this.scared = false;
			this.otherIndex = Math.floor(Math.random()*(ballCount-1))
			this.timer = 0
		}
		if (!this.scared) {


			var runFromIndex = this.index < ballCount - 10 ? this.index + 10 : this.index - (ballCount) + 10
			// var index = this.index < ballCount - 1 ? this.index + 1 : this.index - (ballCount) + 1
			var index = this.index < ballCount - this.otherIndex ? this.index + this.otherIndex : this.index - (ballCount) + this.otherIndex

			// var heading = {x: balls[index].x - this.x, y: balls[index].y - this.y}
			var heading = {x: balls[index].x - this.x, y: balls[index].y - this.y}
			var centreHeading = {x: centre.x - this.x, y: centre.y - this.y}

			this.goal.x += heading.x / 50
			this.goal.y += heading.y / 50
			this.goal.x += centreHeading.x / 100
			this.goal.y += centreHeading.y / 100

		}
	}
	update () {
		this.react()
		this.collision ()
		this.draw()
	}
	collision () {
		var head = {x: (player.x - this.x), y:(player.y - this.y)}
		var dist = Math.hypot(head.x,head.y)

		if (dist < vacinity) {
			this.goal.x -= (300*head.x)/(dist*dist)
			this.goal.y -= (300*head.y)/(dist*dist)
		} else {
			balls.forEach((ball) => {
				if (ball != this) {
					var heading = {x: (ball.x - this.x), y:(ball.y - this.y)}
					var distance = Math.hypot(heading.x,heading.y)
					this.goal.x -= 30*heading.x/(distance*distance)
					this.goal.y -= 30*heading.y/(distance*distance)
				}
			})
		}

		var goalHead = {x: (this.goal.x - this.x), y:(this.goal.y - this.y)}
		var goalDist = Math.hypot(goalHead.x,goalHead.y)

		if (goalDist > maxSpeed) {
			this.x += (goalHead.x / goalDist) * maxSpeed
			this.y += (goalHead.y / goalDist) * maxSpeed
		} else {
			this.x = this.goal.x
			this.y = this.goal.y
		}
	}
}

canvas.addEventListener('mousedown', (event) => {

	mouseIsDown = true 
	var rect = canvas.getBoundingClientRect()
	mousePosition.x = event.clientX - rect.left
	mousePosition.y = event.clientY - rect.top
})
canvas.addEventListener('mousemove', (event) => {

	var rect = canvas.getBoundingClientRect()
	mousePosition.x = event.clientX - rect.left
	mousePosition.y = event.clientY - rect.top
})
canvas.addEventListener('mouseup', (event) => {
	
	mouseIsDown = false
})

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

	balls.forEach((ball) => {
		ball.react()
		ball.collision()
		ball.draw()
	})
}
init()
animate()