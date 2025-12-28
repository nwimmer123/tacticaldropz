    const canvas = document.getElementById('battlefield');
    const ctx = canvas.getContext('2d');
    const inchToPixel = 15;
    
    let currentTool = 'draw';
    let currentColor = '#00ff00';
    let currentDeployment = 'tippingPoint';
    let currentLayout = 0;
    let gameMode = 'incursion';
    
    let drawings = [];
    let currentPoints = [];
    let measurePoints = [];
    let isDrawing = false;
    let drawingHintShown = false;
    let hintElement = null;
    
    const terrainImages = [];
    let imagesLoaded = 0;

    const terrainImageData = [
      'layouts/l1.png',
      'layouts/l2.png',
      'layouts/l3.png',
      'layouts/l4.png',
      'layouts/l5.png',
      'layouts/l6.png',
      'layouts/l7.png',
      'layouts/l8.png'
    ];
  
    terrainImageData.forEach((path, index) => {
      const img = new Image();
      img.onload = () => {
        terrainImages[index] = img;
        imagesLoaded++;
        if (imagesLoaded === terrainImageData.length) {
          drawScene();
        }
      };
      img.onerror = () => {
        imagesLoaded++;
        if (imagesLoaded === terrainImageData.length) {
          drawScene();
        }
      };
      img.src = path;
    });

    function inchesToPixels(inches, rate){
      return (inches * rate);
    }

    const deploymentZones = {
      tippingPoint: {
        name: 'Tipping Point',
        zones: [
          { 
            points: [[0,0], [180,0], [180,360], [300,360], [300,720], [0,720]], 
            color: 'rgba(255,107,107,0.25)',
            stroke: 'rgba(255,107,107,0.6)'
          },
          { 
            points: [[600,0], [900,0], [900,720], [720,720], [720, 360], [600, 360]], 
            color: 'rgba(78,205,196,0.25)',
            stroke: 'rgba(78,205,196,0.6)'
          }
        ],
        objectivesIncursion: [
          {x: inchesToPixels(22, inchToPixel), y: inchesToPixels(10, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(38, inchToPixel), y: inchesToPixels(38, inchToPixel)},
          {x: inchesToPixels(16, inchToPixel), y: inchesToPixels(34, inchToPixel)},
          {x: inchesToPixels(44, inchToPixel), y: inchesToPixels(14, inchToPixel)}
        ],
        objectivesStrikeForce: [
          {x: inchesToPixels(22, inchToPixel), y: inchesToPixels(8, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(38, inchToPixel), y: inchesToPixels(40, inchToPixel)},
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(38, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(10, inchToPixel)}
        ]
      },
      hammerAnvil: {
        name: 'Hammer and Anvil',
        zones: [
          { 
            points: [[0, 0], [270, 0], [270, 720], [0,720]], 
            color: 'rgba(255,107,107,0.25)',
            stroke: 'rgba(255,107,107,0.6)'
          },
          { 
            points: [[630, 0], [900, 0], [900, 720], [630, 720]], 
            color: 'rgba(78,205,196,0.25)',
            stroke: 'rgba(78,205,196,0.6)'
          }
        ],
        objectivesIncursion: [
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(8, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(40, inchToPixel)}
        ],
        objectivesStrikeForce: [
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(6, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(42, inchToPixel)},
          {x: inchesToPixels(10, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(50, inchToPixel), y: inchesToPixels(24, inchToPixel)}
        ]
      },
      searchDestroy: {
        name: 'Search and Destroy',
        zones: [
          { 
            points: [[450,0], [900,0], [900,360], [585,360], [450,225]], 
            color: 'rgba(255,107,107,0.25)',
            stroke: 'rgba(255,107,107,0.6)'
          },
          { 
            points: [[0,360], [315,360], [450,495], [450,720], [0,720]], 
            color: 'rgba(78,205,196,0.25)',
            stroke: 'rgba(78,205,196,0.6)'
          }
        ],
        objectivesIncursion: [
          {x: inchesToPixels(16, inchToPixel), y: inchesToPixels(12, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(44, inchToPixel), y: inchesToPixels(36, inchToPixel)},
          {x: inchesToPixels(16, inchToPixel), y: inchesToPixels(36, inchToPixel)},
          {x: inchesToPixels(44, inchToPixel), y: inchesToPixels(12, inchToPixel)}
        ],
        objectivesStrikeForce: [
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(10, inchToPixel)},
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(38, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(10, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(38, inchToPixel)}
        ]
      },
      crucibleBattle: {
        name: 'Crucible of Battle',
        zones: [
          { 
            points: [[0,0], [450,720], [0,720]], 
            color: 'rgba(255,107,107,0.25)',
            stroke: 'rgba(255,107,107,0.6)'
          },
          { 
            points: [[450,0], [900,0], [900,720]],
            color: 'rgba(78,205,196,0.25)',
            stroke: 'rgba(78,205,196,0.6)'
          }
        ],
        objectivesIncursion: [
          {x: inchesToPixels(22, inchToPixel), y: inchesToPixels(10, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(38, inchToPixel), y: inchesToPixels(38, inchToPixel)},
          {x: inchesToPixels(16, inchToPixel), y: inchesToPixels(36, inchToPixel)},
          {x: inchesToPixels(44, inchToPixel), y: inchesToPixels(12, inchToPixel)}
        ],
        objectivesStrikeForce: [
          {x: inchesToPixels(20, inchToPixel), y: inchesToPixels(8, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(40, inchToPixel), y: inchesToPixels(40, inchToPixel)},
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(38, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(10, inchToPixel)}
        ]
      },
      sweepingEngage: {
        name: 'Sweeping Engagement',
        zones: [
          { 
            points: [[0,0], [900,0], [900,210], [450,210], [450,120], [0,120]], 
            color: 'rgba(255,107,107,0.25)',
            stroke: 'rgba(255,107,107,0.6)'
          },
          { 
            points: [[0,510], [450,510], [450, 600], [900,600], [900,720], [0,720]], 
            color: 'rgba(78,205,196,0.25)',
            stroke: 'rgba(78,205,196,0.6)'
          }
        ],
        objectivesIncursion: [
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(18, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(30, inchToPixel)},
          {x: inchesToPixels(40, inchToPixel), y: inchesToPixels(8, inchToPixel)},
          {x: inchesToPixels(20, inchToPixel), y: inchesToPixels(40, inchToPixel)}
        ],
        objectivesStrikeForce: [
          {x: inchesToPixels(10, inchToPixel), y: inchesToPixels(18, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(50, inchToPixel), y: inchesToPixels(30, inchToPixel)},
          {x: inchesToPixels(42, inchToPixel), y: inchesToPixels(6, inchToPixel)},
          {x: inchesToPixels(18, inchToPixel), y: inchesToPixels(42, inchToPixel)}
        ]
      },
      dawnWar: {
        name: 'Dawn of War',
        zones: [
          { 
            points: [[0,0], [900,0], [900,180], [0,180]], 
            color: 'rgba(255,107,107,0.25)',
            stroke: 'rgba(255,107,107,0.6)'
          },
          { 
            points: [[0,540], [900,540], [900,720], [0,720]], 
            color: 'rgba(78,205,196,0.25)',
            stroke: 'rgba(78,205,196,0.6)'
          }
        ],
        objectivesIncursion: [
          {x: inchesToPixels(14, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(46, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(8, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(40, inchToPixel)}
        ],
        objectivesStrikeForce: [
          {x: inchesToPixels(10, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(50, inchToPixel), y: inchesToPixels(24, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(6, inchToPixel)},
          {x: inchesToPixels(30, inchToPixel), y: inchesToPixels(42, inchToPixel)}
        ]
      }
    };

    function showDrawingHint() {
      if (hintElement) return;
      
      const canvasWrapper = document.getElementById('canvasWrapper');
      hintElement = document.createElement('div');
      hintElement.className = 'drawing-hint';
      hintElement.textContent = '👆 Drawing mode active - Double-click to finish';
      canvasWrapper.appendChild(hintElement);
    }

    function hideDrawingHint() {
      if (hintElement) {
        hintElement.remove();
        hintElement = null;
      }
    }

    function toggleMode() {
      const toggle = document.getElementById('modeToggle');
      gameMode = toggle.checked ? 'strikeForce' : 'incursion';
      drawScene();
    }

    function init() {
      const topNav = document.getElementById('topNav');
      for (let i = 1; i <= 8; i++) {
        const tab = document.createElement('button');
        tab.className = `tab ${i === 1 ? 'active' : ''}`;
        tab.textContent = `Layout ${i}`;
        tab.dataset.layout = i - 1;
        tab.onclick = () => selectLayout(i - 1);
        topNav.appendChild(tab);
      }

      const sidebar = document.getElementById('leftSidebar');
      Object.keys(deploymentZones).forEach(key => {
        const option = document.createElement('div');
        option.className = `deploy-option ${key === 'tippingPoint' ? 'active' : ''}`;
        option.textContent = deploymentZones[key].name;
        option.dataset.deployment = key;
        option.onclick = () => selectDeployment(key);
        sidebar.appendChild(option);
      });

      document.querySelectorAll('[data-tool]').forEach(btn => {
        btn.onclick = () => selectTool(btn.dataset.tool);
      });

      document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.onclick = () => selectColor(swatch.dataset.color);
      });

      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('dblclick', handleDoubleClick);

      drawScene();
    }

    function selectLayout(index) {
      currentLayout = index;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab')[index].classList.add('active');
      drawScene();
    }

    function selectDeployment(deployment) {
      currentDeployment = deployment;
      document.querySelectorAll('.deploy-option').forEach(o => o.classList.remove('active'));
      document.querySelector(`[data-deployment="${deployment}"]`).classList.add('active');
      drawScene();
    }

    function selectTool(tool) {
      currentTool = tool;
      currentPoints = [];
      measurePoints = [];
      hideDrawingHint();
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      document.querySelector(`[data-tool="${tool}"]`).classList.add('active');
      drawScene();
    }

    function selectColor(color) {
      currentColor = color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      document.querySelector(`[data-color="${color}"]`).classList.add('active');
    }

    function drawScene() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (terrainImages[currentLayout]) {
        ctx.drawImage(terrainImages[currentLayout], 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = '#2a2a3e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= canvas.width; i += 45) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i <= canvas.height; i += 45) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      const deployment = deploymentZones[currentDeployment];
      if (deployment) {
        deployment.zones.forEach(zone => {
          ctx.fillStyle = zone.color;
          ctx.strokeStyle = zone.stroke;
          ctx.lineWidth = 3;
          ctx.beginPath();
          zone.points.forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt[0], pt[1]);
            else ctx.lineTo(pt[0], pt[1]);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });

        const objectives = gameMode === 'incursion' 
          ? deployment.objectivesIncursion 
          : deployment.objectivesStrikeForce;
        
        objectives.forEach(obj => {
          ctx.strokeStyle = '#ff0000';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, 45, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }

      drawings.forEach(drawing => {
        if (drawing.type === 'unit') {
          ctx.strokeStyle = drawing.color;
          ctx.lineWidth = 3;
          ctx.fillStyle = 'transparent';
          ctx.beginPath();
          drawing.points.forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.closePath();
          ctx.stroke();

          if (drawing.label) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            const centerX = drawing.points.reduce((sum, pt) => sum + pt.x, 0) / drawing.points.length;
            const centerY = drawing.points.reduce((sum, pt) => sum + pt.y, 0) / drawing.points.length;
            ctx.fillText(drawing.label, centerX, centerY + 25);
          }
        } else if (drawing.type === 'measure') {
          ctx.strokeStyle = '#ff8800';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(drawing.start.x, drawing.start.y);
          ctx.lineTo(drawing.end.x, drawing.end.y);
          ctx.stroke();

          const dx = drawing.end.x - drawing.start.x;
          const dy = drawing.end.y - drawing.start.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const inches = (dist / 45 * 3).toFixed(1);
          
          ctx.fillStyle = '#ff8800';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          const midX = (drawing.start.x + drawing.end.x) / 2;
          const midY = (drawing.start.y + drawing.end.y) / 2;
          
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(midX - 25, midY - 15, 50, 24);
          ctx.fillStyle = '#ff8800';
          ctx.fillText(`${inches}"`, midX, midY + 4);

          ctx.fillStyle = '#ff8800';
          ctx.beginPath();
          ctx.arc(drawing.start.x, drawing.start.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(drawing.end.x, drawing.end.y, 6, 0, Math.PI * 2);
          ctx.fill();
        } else if (drawing.type === 'sight') {
          // ctx.fillStyle = '#0066cc';
          // ctx.strokeStyle = '#fff';
          // ctx.lineWidth = 2;
          // ctx.beginPath();
          // ctx.arc(drawing.x, drawing.y, 18, 0, Math.PI * 2);
          // ctx.fill();
          // ctx.stroke();
          // ctx.fillStyle = '#fff';
          // ctx.font = 'bold 20px sans-serif';
          // ctx.textAlign = 'center';
          // ctx.textBaseline = 'middle';
          // ctx.fillText('👁', drawing.x, drawing.y);
        } else if (drawing.type === 'label') {
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          const textWidth = ctx.measureText(drawing.text).width;
          ctx.fillRect(drawing.x - textWidth/2 - 8, drawing.y - 14, textWidth + 16, 28);
          ctx.fillStyle = '#fff';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(drawing.text, drawing.x, drawing.y);
        }
      });

      if (currentPoints.length > 0 && currentTool === 'draw') {
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = 3;
        ctx.fillStyle = 'transparent';
        ctx.beginPath();
        currentPoints.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        currentPoints.forEach(pt => {
          ctx.fillStyle = currentColor;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    function handleMouseDown(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (currentTool === 'draw') {
        if (currentPoints.length === 0 && !drawingHintShown) {
          showDrawingHint();
        }
        currentPoints.push({x, y});
        drawScene();
      } else if (currentTool === 'measure') {
        if (measurePoints.length === 0) {
          measurePoints.push({x, y});
        } else {
          drawings.push({
            type: 'measure',
            start: measurePoints[0],
            end: {x, y}
          });
          measurePoints = [];
          drawScene();
        }
      } else if (currentTool === 'objective') {
        drawings.push({
          type: 'objective',
          x, y, r: 45
        });
        drawScene();
      } else if (currentTool === 'sight') {
        drawings.push({
          type: 'sight',
          x, y
        });
        drawScene();
      } else if (currentTool === 'label') {
        const text = prompt('Enter label text:');
        if (text) {
          drawings.push({
            type: 'label',
            x, y, text
          });
          drawScene();
        }
      }
    }

    function handleMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (measurePoints.length === 1 && currentTool === 'measure') {
        drawScene();
        ctx.strokeStyle = 'rgba(255,136,0,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(measurePoints[0].x, measurePoints[0].y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function handleDoubleClick(e) {
      if (currentTool === 'draw' && currentPoints.length > 2) {
        const unitName = document.getElementById('unitName').value || 'Unit';
        drawings.push({
          type: 'unit',
          points: [...currentPoints],
          color: currentColor,
          label: unitName
        });
        currentPoints = [];
        document.getElementById('unitName').value = '';
        drawingHintShown = true;
        hideDrawingHint();
        drawScene();
      }
    }

    function clearCanvas() {
      if (confirm('Clear all drawings?')) {
        drawings = [];
        currentPoints = [];
        measurePoints = [];
        drawingHintShown = false;
        hideDrawingHint();
        drawScene();
      }
    }

    function savePlan() {
      const plan = {
        deployment: currentDeployment,
        layout: currentLayout,
        drawings: drawings,
        gameMode: gameMode
      };
      const json = JSON.stringify(plan, null, 2);
      const blob = new Blob([json], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '40k-deployment-plan.json';
      a.click();
    }

    function loadPlan() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = event => {
          try {
            const plan = JSON.parse(event.target.result);
            currentDeployment = plan.deployment || 'tippingPoint';
            currentLayout = plan.layout || 0;
            drawings = plan.drawings || [];
            gameMode = plan.gameMode || 'incursion';
            
            document.getElementById('modeToggle').checked = (gameMode === 'strikeForce');
            
            selectDeployment(currentDeployment);
            selectLayout(currentLayout);
            drawScene();
          } catch (err) {
            alert('Error loading plan: ' + err.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    init();