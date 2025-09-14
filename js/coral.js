// --- Next-up colour preview ---
const COLORS = ['red','lightGreen','blue','yellow','pink'];
let nextColor = COLORS[Math.floor(Math.random()*COLORS.length)];

function setNextPreview(){
  const el = document.getElementById('nextDot');
  if (el) el.style.color = nextColor;
}

class Dot {
    constructor(x, y, color, size) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = size;
        this.fullSize = Math.floor(Math.random() * 14) + 15;
        this.cloned = false;
        this.clonedTimer = 60;
    }

    grow(dt) {
        this.size += dt / 500;
        if (this.size > this.fullSize) {
            this.size = this.fullSize;
        }
    }

    canReproduce() {
        return this.size >= this.fullSize && this.clonedTimer < 1;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x * cellSize + cellSize / 2, this.y * cellSize + cellSize / 2, this.size / 2, 0, 2 * Math.PI);
        ctx.fillStyle = this.color;
        ctx.fill();
    }

    update(dt, grid) {
        if (this.clonedTimer > 0) {
            this.clonedTimer -= 1;
        }
        this.grow(dt);
        if (this.canReproduce()) {
            const positions = grid.getAvailablePositions(this.x, this.y);
            if (positions.length > 0) {
                const pos = positions[Math.floor(Math.random() * positions.length)];
                const child = new Dot(pos.x, pos.y, this.color, 0);
                grid.addDot(child);
                this.clonedTimer = 60;
            }
        }
    }
}

class Grid {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.grid = Array(width).fill().map(() => Array(height).fill(null));
    }

    addDot(dot) {
        if (this.grid[dot.x][dot.y] === null) {
            this.grid[dot.x][dot.y] = dot;
            return true;
        }
        return false;
    }

    // --- Reset support ---
    clear(){
        for (let x=0;x<this.width;x++){
            for (let y=0;y<this.height;y++){
                this.grid[x][y] = null;
            }
        }
    }

    getAvailablePositions(x, y) {
        const positions = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = x + dx;
                const ny = y + dy;
                if (
                    nx >= 0 &&
                    nx < this.width &&
                    ny >= 0 &&
                    ny < this.height &&
                    this.grid[nx][ny] === null
                ) {
                    positions.push({ x: nx, y: ny });
                }
            }
        }
        return positions;
    }

    draw(ctx) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                if (this.grid[x][y] !== null) {
                    this.grid[x][y].draw(ctx);
                }
            }
        }
    }

    update(dt) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                if (this.grid[x][y] !== null) {
                    this.grid[x][y].update(dt, this);
                }
            }
        }
    }
}

let lastTime = Date.now();

const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

const rows = 20;
const cellSize = 30;

// use the real content box width (exclude padding)
const container = canvas.parentElement;
const cs = getComputedStyle(container);
const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
const innerW = Math.max(0, container.clientWidth - padX);

const cols = Math.max(1, Math.floor(innerW / cellSize));
const grid = new Grid(cols, rows);

// left-align inside the content box
canvas.style.display = 'block';
canvas.style.margin = '0';

// backing pixels
canvas.width  = cols * cellSize * dpr;
canvas.height = rows * cellSize * dpr;

// CSS pixels
canvas.style.width  = (cols * cellSize) + 'px';
canvas.style.height = (rows * cellSize) + 'px';

// Adjust the drawing operations for DPR
function drawGrid() {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    grid.draw(ctx);
    ctx.restore();
}

function gameLoop() {
    const now = Date.now();
    const dt = now - lastTime;
    lastTime = now;
    grid.update(dt);
    drawGrid();
    requestAnimationFrame(gameLoop);
}

// Place a dot and roll the next colour
canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect();

    const scaleX = (canvas.width / dpr) / rect.width;
    const scaleY = (canvas.height / dpr) / rect.height;

    const x = Math.floor(((event.clientX - rect.left) * scaleX) / cellSize);
    const y = Math.floor(((event.clientY - rect.top) * scaleY) / cellSize);

    if (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
        const dot = new Dot(x, y, nextColor, 10);
        grid.addDot(dot);
        nextColor = COLORS[Math.floor(Math.random()*COLORS.length)];
        setNextPreview();
    }
});

// Reset button (if present in HTML)
document.getElementById('reset')?.addEventListener('click', () => grid.clear());

// Initialize preview and start
setNextPreview();
gameLoop();