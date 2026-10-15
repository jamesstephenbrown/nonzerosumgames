canvas = document.querySelector('canvas')
c = canvas.getContext('2d')

var rect = canvas.getBoundingClientRect()

canvas.width = innerWidth - 30 // to avoid scroll bar
canvas.height = 1000
centre = { x: canvas.width / 2, y: canvas.height / 2 }
ballCount = 40
tailCount = 10
mouseIsDown = false
mousePosition = { x: 0, y: 0 }
balls = []
tails = []
vacinity = 200
maxSpeed = 2
activeTouch = null;

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

canvas.addEventListener("touchstart", touchDown, false);
canvas.addEventListener("touchmove", touchMoved, false);
canvas.addEventListener("touchend", touchUp, false);
canvas.addEventListener("touchcancel", touchUp, false);

function touchDown(evt) {
    evt.preventDefault();
    if (mouseIsDown) {
    	closestBall = null;
    }
    mouseIsDown = true;

    // Ignore touches after the first.
    if (activeTouch != null) {
        return;
    }

    if (evt.changedTouches.length > 0) {
        activeTouch = evt.changedTouches[0].identifier;
        mousePosition = getTouchPos(evt);
    }
}

function touchUp(evt)  {
    mouseIsDown = false;
    mousePosition = getTouchPos(evt);
    activeTouch = null;
}

function touchMoved(evt)  {
    mouseIsDown = true;
    mousePosition = getTouchPos(evt);
}

function getTouchPos(evt)  {

    for( var i = 0; i < evt.touches.length; i++ ) {
        if (evt.touches[i].identifier == activeTouch) {
			rect = canvas.getBoundingClientRect()
			mousePosition.x = evt.touches[i].clientX - rect.left
			mousePosition.y = evt.touches[i].clientY - rect.top
            break;
        }
    }
    return { 'x': mousePosition.x, 'y': mousePosition.y }
}



class Dot {
	constructor (position, radius, index, color) {
		this.x = position.x
		this.y = position.y
		this.color = color
		this.goal = {x:this.x,y:this.y}
		this.index = index
		this.radius = radius
		this.timer = 0
		this.timeLimit = Math.floor(Math.random()*(1000)+500)
		this.otherIndex = Math.floor(Math.random()*(ballCount-1))
		this.scared = false
		this.ball = "none"
		this.tail = "none"

		console.log(this.index, this.x, this.y)
	}
	draw () {
		c.beginPath()
		c.arc(this.x, this.y, this.radius, Math.PI * 2, false)
		c.fillStyle = this.color
		c.fill()
		c.fillStyle = 'black'
		c.lineWidth = 8;
		c.stroke()
		c.closePath()
		if (this.tail != "none" || this.ball != "none") {
			console.log("Drawing at " + this.x + ", " + this.y)
        }
	}
}
class Tail extends Dot {




	check() {
		if (this.color == "none") {

			var playerHead = { x: (player.x - this.x), y: (player.y - this.y) }
			var playerDist = Math.hypot(playerHead.x, playerHead.y)
			if (playerDist < this.radius + player.radius) {
				//console.log("coloring")
				this.color = player.color;
			}
		}
		if (this.color != "none" && this.ball == "none") {
			balls.forEach((ball) => {
				var heading = { x: (ball.x - this.x), y: (ball.y - this.y) }
				var distance = Math.hypot(heading.x, heading.y)
				if (distance < this.radius + ball.radius) {
					this.ball = ball
					ball.tail = this
                }
			})
		}

		if (this.ball != "none") {
			var ballHead = { x: (this.x - this.ball.x), y: (this.y - this.ball.y) }
			var ballDist = Math.hypot(ballHead.x, ballHead.y)
			this.x = this.ball.x + (ballHead.x / (ballDist + 1)) * 20
			this.y = this.ball.y + (ballHead.y / (ballDist + 1)) * 20
			//console.log("this position = (" + this.x + ", " + this.y + ")")
			//console.log("this position = (" + this.ball.x + ", " + this.ball.y + ")")
		}
	}

	update() {
		this.check()
		this.draw()
	}
	// when player collides with these color with player's color
	// when a ball collides with these generate a tail which follows the ball
	// when this happens - ball stops avoiding player
	// when you collide with a ball that is not avoiding you (with a tail) you develop a tail.
	// now you can approach and make friends with all of them.
}

class Player extends Dot {
	follow () {
		// follow mouse position at a restricted speed

		if (mouseIsDown) {
			this.goal.x = mousePosition.x
			this.goal.y = mousePosition.y

			var heading = {x: this.goal.x - this.x, y: this.goal.y - this.y}
			this.x += heading.x / 10
			this.y += heading.y / 10
		}
	}
	update () {
		this.follow()
		this.draw()
	}
}
player = new Player({x:centre.x,y: 20}, 15, -1, 'lightGreen');

class Ball extends Dot {

	react () {
		this.goal.x = this.x
		this.goal.y = this.y

		var head = {x: (player.x - this.x), y:(player.y - this.y)}
		var dist = Math.hypot(head.x,head.y)

		if (dist < vacinity && this.tail == "none") {
			this.scared = true;
			this.interested = false;
		} else {
			this.scared = false;
			this.interested = true;
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

		if (dist < vacinity && this.scared) {
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

			// player interaction comes in here

			// a little bit of hovering

			// then a touch

			// when touch generate a tail with the toucher's color

			// attach tail to player

			// I also need to stop one ball taking more than one tail

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
			findPosition(),Math.random() * (5) + 10, v, 'yellow'
			)
		)
	}
	closestBall = balls[0]

	for (var i = tailCount; i >= 0; i--) {
		console.log("Making a tail")
		v = i
		tails.push(new Tail(
			findPosition(), 8, v, "none"
		))
	}
}
function animate() {
	requestAnimationFrame(animate)
	c.fillStyle = '#55AAE3'
	c.fillRect(0,0,canvas.width,canvas.height)

	player.update();
	balls.forEach((ball) => { ball.update() })
	tails.forEach((tail) => { tail.update() })
}
init()
animate()