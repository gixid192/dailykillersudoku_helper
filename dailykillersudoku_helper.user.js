// ==UserScript==
// @name         DailyKillerSudoku Helpers
// @namespace    http://tampermonkey.net/
// @version      250823
// @description  add some helpers to make it easy to play on this site
// @author       gixid192
// @match        https://www.dailykillersudoku.com/*/puzzle/*
// @match        https://www.dailykillersudoku.com/puzzle/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=dailykillersudoku.com
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
    /* globals DKS, $ */

    let DELAY_BETWEEN_INPUTS_TIME = 1600; //ms
    let enableAutoCheck = true;
    let toggleBtnIdentifier = 'newbtn';

    let ALL_CAGES, ALL_CELLS, ALL_BOXS, PUZZLE_NUMBER, PUZZLE_INFO;
    let UNDO_LIST = [];
    let STORAGE_KEY;

    ready();
    function restoreState(){
        let k = 'currentPuzzle.board.' + PUZZLE_NUMBER;
        if(DKS.localStorage.get(k)){
            let t = {
                board: DKS.localStorage.get(k),
                numHintsUsed: 0,
                timer: DKS.localStorage.get('currentPuzzle.timer')
            };
            DKS.puzzle._setStateAndRender(t);
        }
        //clean up if too many saved puzzle
        let currentUnsolvedBoards = Object.keys(localStorage).filter(k => k.includes('board.'));
        if(currentUnsolvedBoards.length > 2){
            currentUnsolvedBoards.forEach(k => localStorage.removeItem(k))
        }
    }
    function addToUndoList(cage){
        let firstCell = cage.cells[0];
        let cellPos = {x: firstCell.row, y: firstCell.column};
        UNDO_LIST.push({sum: cage.sum, pos: cellPos});
        localStorage.setItem(STORAGE_KEY, JSON.stringify(UNDO_LIST));
    }
    function restoreUndoList(){
        //on continue playing after refresh page
        let undo = localStorage.getItem(STORAGE_KEY)
        if(undo){
            UNDO_LIST = JSON.parse(undo);
            UNDO_LIST.forEach(obj => {
                let {sum, pos} = obj;
                addSumToCage(ALL_CELLS[pos.x][pos.y].cage, sum)
            });

            return;
        }

        //on play again
        //restore cage sum on GTK
        UNDO_LIST.forEach(obj => {
            let {pos} = obj;
            let cage = ALL_CELLS[pos.x][pos.y].cage
            cage.sum = 0;
            cage.combinations.combinations = [];
        });
    }
    function doubleTapOn(elements, cb){
        let clickTimer = null;
        let result = false;
        if(elements.length < 2){
            elements = [elements];
        }
        $(elements.join(', ')).on('touchend click', function(e){
            let evt = e.originalEvent;
            if (clickTimer == null) {
                clickTimer = setTimeout(function () {
                    clickTimer = null;
                }, 500)
            } else {
                clearTimeout(clickTimer);
                clickTimer = null;
                cb(evt)
            }
        });
    }
    function main(){
        //always open up Comb tab
        $('#puzzleCombinations h2').trigger('click');
        restoreState();
        restoreUndoList();
        autoAddSumCage();

        addToggleAutoCheckBtn();
        isCorrect();

        setupListeners();

        autoFillPencilKnownCages();

        fillAllInnieInBox();
        findInnieRowColumn();
        find2RowCol();
        find3RowCol();

        addNoteBox();
    }

    function isMobile(){
        return $('.tabs-background').css('display') === 'block';
    }
    function addNoteBox(){
        if(isMobile()){
            return;
        }
        //if existed
        if($('textarea').length){return};
        let container = $('.puzzle-page-container');
        let textArea = `<textarea style="float: right; height: 139px;" cols="70" rows="5"></textarea>`;
        $(container).prepend(textArea);
    }

    function verifyPencilMark(curCell, num){
        let {row: curRow, column: curCol} = curCell;
        let cellsInRow = ALL_CELLS[curRow];
        let cellsInCol = ALL_CELLS.map(row => row[curCol]);

        let activeNums = [];

        function collectAtiveNumbers(cell){
            if(cell.value !== 0){
                activeNums.push(cell.value);
            }
        }

        cellsInRow.forEach(collectAtiveNumbers)

        cellsInCol.forEach(collectAtiveNumbers)

        //cage itself
        let curCellCage = ALL_CELLS[curRow][curCol]['cage']
        curCellCage.cells.forEach(collectAtiveNumbers)


        //3x3 subgrid
        let blockX = curRow - curRow % 3;
        let blockY = curCol - curCol % 3;
        for(let i = 0; i < 3; i++){
            for(let j = 0; j < 3; j++){
                let cell = ALL_CELLS[blockX + i][blockY + j];
                collectAtiveNumbers(cell)
            }
        }

        let pencil = curCell.pencilMarks;
        let wrongNums = pencil.filter(p => activeNums.includes(p));
        let remainNums = pencil.filter(p => !wrongNums.includes(p));

        if(!wrongNums.length) return;

        let wrongNumElm = $(`
                <span style="color: red">${wrongNums.join('')}</span>
                <span>${remainNums.join('')}</span>
                `);
        curCell.element.find('.cell-contents.pencil-marks').html(wrongNumElm);
    }

    function setupListeners(){
        doubleTapOn(['#puzzleCombinations header', '#puzzleCalculator header'], function(e){
            let filterModal = window.DKS.Modal.secondaryButton({
                html: `<input id="filterNum" class="calculator-filter calculator-input" type="number" pattern="[0-9]*" placeholder="Filter" />
                   <input id="filterInEx" class="calculator-filter calculator-input" type="checkbox" checked=true />`
            ,
                callback: () => {
                }
            });
            window.DKS.modal.info("body", "OK", [filterModal]);
            $('#modal').on('shown.bs.modal', function (e) {
                if($('#modal').find('#filterNum')){
                    $('#filterNum').focus();
                }
            })

            let clickedElm = e.target
            $('#filterInEx').on('change', () => {$('#filterNum').trigger('input')})
            $('#filterNum').on('input', (e) => {
                let nums = e.target.value.split('');
                if(!nums.length) return;
                let filterCon = (comb, num) => {
                    let isInclude = $('#filterInEx').prop('checked') === true;
                    if(isInclude){
                        return !comb.combination.values.includes(num)
                    }
                    return comb.combination.values.includes(num);
                }
                let parentElm = $(clickedElm).parents('[id]')[0];
                let isCaculatorTab = parentElm.getAttribute('id') === 'puzzleCalculator'
                let currentCombinations = $(parentElm).find('.combination-container');
                currentCombinations.each((_, comb) => {
                    let c = $(comb)[0];
                    if(c.combination.isEnabled === false){
                        c.click();
                    }
                })
                currentCombinations.each((_, comb) => {
                    let c = $(comb)[0];
                    nums.forEach(num => {
                        if(filterCon(c, +num) && c.combination.isEnabled === true){
                            c.click();
                        }
                    })

                })
            })
        });
        //overwrite DKS's original methods
        let _isTargetingPuzzleElementOrigin = DKS.Puzzle.prototype._isTargetingPuzzleElement;
        DKS.Puzzle.prototype._isTargetingPuzzleElement = function(t){
            if(t.target.tagName.toLowerCase() === 'textarea'){
                return true;
            }
            return _isTargetingPuzzleElementOrigin.call(this, t);
        }
        //the way it works is checking if the inputs are in the allow list
        //so we just need to add our fields to the list
        //remember to add to the below, removeFocus function too
        let isFocusInInputsOrigin = DKS.Calculator.prototype.isFocusInInputs;
        DKS.Calculator.prototype.isFocusInInputs = function(){
            return isFocusInInputsOrigin.call(this) || $('#filterNum').is(":focus") || $('textarea').is(":focus");
        }
        let removeFocusOrigin = DKS.Calculator.prototype.removeFocus;
        DKS.Calculator.prototype.removeFocus = function(){
            return removeFocusOrigin.call(this), $('#filterNum').blur(), $('textarea').blur();
        }
        let _onKeyPressEventOrigin = DKS.Puzzle.prototype._onKeyPressEvent;
        DKS.Puzzle.prototype._onKeyPressEvent = function(t, n){
            let o = t.keyCode || t.which;
            let isInNoteField = $('textarea').is(":focus")
            if (o === DKS.Constants.KEY_ENTER && isInNoteField){
                return false;
            }
            return _onKeyPressEventOrigin.call(this, t, n);
        }

        let storageSet = DKS.LocalStorage.prototype.set;
        DKS.LocalStorage.prototype.set = function(t, e){
            if(t === 'currentPuzzle.board'){
                t = t + '.' + PUZZLE_NUMBER;
            }
            return storageSet.call(this, t, e);
        }

        function handleToggleValue(cell, inputNum){
            setTimeout(() => {
                if(!enableAutoCheck) return;
                isCorrect();
                if(inputNum < 10 && cell.value == 0){ //isPencilMark won't work when removing pecils
                    verifyPencilMark(cell, inputNum);
                }
                if(cell.value == 0) return; //pencilmark
                if(window.DKS.puzzle.board.checkSolution() != 0) return;
                if(window.DKS.puzzle.hasBeenSolved) return;
                //if(this.value !== this._correctValue) return;
                window.DKS.puzzle.board.checkIfSolved(true); //true to display msg; auto display msg aleady, no need return;

                //known bug from this puzzle (and some others)
                //first let the auto fill work, box 2 cage 7 fill 34
                //restart, check the some random cage, the combinations will be disabled
                //not sure why and how it happens but disable this function solved the issue

                disableCombinations(cell);
                fillRemainNumber(cell);
                removePencilMark(cell.value, cell.row, cell.column);
            }, DELAY_BETWEEN_INPUTS_TIME)
        }
        let toggleValueOrigin = DKS.Cell.prototype.toggleValue;
        DKS.Cell.prototype.toggleValue = function(number, isPencilMark){
            let cell = this;
            handleToggleValue(cell, number)
            return toggleValueOrigin.call(this, number, isPencilMark);
        }

        DKS.puzzle._combinations._renderSum = function() {
            let html = "<div><div class='combinations-sum-description'>Combined sum of<br>highlighted cages</div><div>" + calRemaining(this._sum) + "</div></div>";
            //add overflow to make it scroll-able
            html = $("<div style='overflow-y: auto' class='combinations-sum-container'></div>").html(html);

            return $(html).appendTo(this._element)
        }
        let calRemaining = n => {
            if(n <= 45){
                return n + '<br>' + 'remain is ' + (45 - n);
            }
            let r = Math.floor(n/45);
            let q = 45 * (r + 1) - n;
            let upToN = n - 45 * r;
            return n + '<br/>' + `+ ${upToN} from 45 * ${r}` + '<br/>' + `- ${q} from 45 * ${r + 1}`;
        }

        let toggleHighlightOrigin = DKS.Board.prototype._toggleValueInHighlightedCells;
        DKS.Board.prototype._toggleValueInHighlightedCells = function(num){
            if(num == DKS.Constants.NUMBER_PAD_BUTTON_UNDERLINE){
                DKS.puzzle.undo();

                return !0;
            }
            if(num == DKS.Constants.NUMBER_PAD_BUTTON_QUESTION_MARK){
                let highlightCells = window.DKS.puzzle.board.highlightedCells;
                if(highlightCells[0].cage.sum === 0 || highlightCells[0].cage.hasModified === true){
                    manuallyAddSumCage(highlightCells);
                    return;
                }

                getNumberAtCurrentColumnsOrRows(highlightCells);
                //getOutieInnieSummary(highlightCells);

                return;

            }
            toggleHighlightOrigin.call(this, num);
        }

        let onPuzzleSolvedOrigin = DKS.Puzzle.prototype.onPuzzleSolved;
        DKS.Puzzle.prototype.onPuzzleSolved = function(){
            onPuzzleSolvedOrigin.call(this, true);
            //for some reason, the modal.show run after this line
            //this line run first created the element but modal.show run afterward removed the element

            setTimeout(x);
            function x(){
                $('#puzzleCombinations .controls-inner').append(
                    $('<div class="combination-container" style="width: 100%;"><span>Restart</span></div>')
                );
                $('#puzzleCombinations .controls-inner span').on('click', () => {
                    //Dialog is made of 2 smaller modals
                    let yesStartAgainModal = window.DKS.Modal.dangerButton({
                        html: 'Yes',
                        callback: () => {
                            //copy from this.startAgain();
                            let n = window.DKS.puzzle;
                            let t;
                            t = n.hasBeenSolved;
                            n.hasBeenSolved = !1;
                            n.board.startAgain();
                            n._undoList = [];
                            n._calculator.clear();
                            n._timer.reset();
                            n._numHintsUsed = 0;
                            n._hasChangedSinceLastSave = !0;
                            n.saveTo(n._storageProvider, !0);
                            n._needToUpdateNumAttemptsStat = t;
                            n._storageProvider.startRegularSave();
                            window.DKS.modal.hide();
                            n.focus();

                            localStorage.removeItem(STORAGE_KEY);
                            main();
                        }
                    });
                    let noStartAgainModal = window.DKS.Modal.secondaryButton({
                        html: "No",
                        callback: function() {
                            return window.DKS.modal.hide()
                        }
                    })
                    window.DKS.modal.info("Start Again?", "Restart?", [yesStartAgainModal, noStartAgainModal]);
                    return;
                })
            }
        }
        //on double click, if it's the only pencil, fill this value
        let clickTimer = null;
        let touchedCell = null;
        $('canvas').on('touchend click', function(e){
            //e.preventDefault();
            let evt = e.originalEvent;
            if (clickTimer == null) {
                touchedCell = window.DKS.puzzle.board.highlightedCells[0];
                clickTimer = setTimeout(function () {
                    clickTimer = null;
                }, 500)
            } else {
                clearTimeout(clickTimer);
                clickTimer = null;
                if(touchedCell !== window.DKS.puzzle.board.highlightedCells[0]) return;
                let coordinate = {
                    x: evt.clientX,
                    y: evt.clientY,
                };
                if(evt instanceof TouchEvent){
                    coordinate = {
                        x: evt.changedTouches[0].clientX,
                        y: evt.changedTouches[0].clientY,
                    };
                }
                let selectedCell = window.DKS.puzzle.board._getCellFromPosition(coordinate);
                if(selectedCell.pencilMarks.length === 1){
                    setValue(selectedCell, selectedCell.pencilMarks[0]);
                }

            }
        });

        /*
        let updateCombOrigin = DKS.Puzzle.prototype._updateCombinationsListBasedOnHighlightedCells;
        DKS.Puzzle.prototype._updateCombinationsListBasedOnHighlightedCells = function(){
            var n, t, s, e, i, o, r;
            if (1 === (r = (t = function() {
                var t, n, e, i;
                for (i = [],
                     t = 0,
                     n = (e = this.board.highlightedCells).length; t < n; t++)
                    s = e[t],
                        i.push(s.cage);
                return i
            }
                            .call(this)).filter(function(t, n, e) {
                return n === e.indexOf(t)
            })).length) {
                return this._combinations.setCombinations(t[0].combinations);

            }
            return this._combinations.setCombinations(t[0].combinations);
            if (1 < r.length) {
                for (e = o = 0,
                     i = r.length; e < i; e++) {
                    if (!(n = r[e]).hasKnownSum() || t.filter(function(t) {
                        return t === n
                    }).length !== n.size())
                        return void this._combinations.clear();
                    o += n.sum
                }
                return this._combinations.displaySum(o)
            }
        }
        */
    }

    window.addEventListener('resize', () => {
        requestAnimationFrame(addToggleAutoCheckBtn) //this help correct the behavior, dont know why
        //to test, open devtool, resize
        //close devtool will break the layout if dont put into rAF
    })
    function addToggleAutoCheckBtn(){
        if($('.' + toggleBtnIdentifier).length){
            $('.' + toggleBtnIdentifier).remove();
        };

        function updateBtn(){
            let btnLabel = enableAutoCheck ? 'ON' : 'OFF';
            let btnStyle = enableAutoCheck ? 'rgb(40, 167, 69)' : '';
            $('.' + toggleBtnIdentifier).css('background-color',btnStyle);
            $('.' + toggleBtnIdentifier).find('span').text(btnLabel).css('color', '#fff');
        }


        $('#puzzleNumberPad').append(
            $(`<div class="number-pad-button-container number-pad-button-normal ${toggleBtnIdentifier}">
                <span class="number-pad-button-contents">ON</span>
            </div>`)
        )
        updateBtn();

        //$('.puzzle-page-container').append($(`<div class="controls-container ${toggleBtnIdentifier}"><header><h2>Toggle</h2></header></div>`))
        $('.' + toggleBtnIdentifier).on('click', () => {
            enableAutoCheck = !enableAutoCheck;
            updateBtn();
            isCorrect();
            /*
            let msg = `AutoCheck has been ${enableAutoCheck ? "enabled" : "disabled"}`;
            window.DKS.modal.info(msg);
            */
            //todo: focus on previous selected cell
            window.DKS.puzzle.focus();
        });


        let promoteBtnStyle = getComputedStyle($('.number-pad-promote-button-contents').parents()[0]);

        ['height', 'left', 'top', 'width'].forEach(s => {
            $('.newbtn').css({
                [s]: promoteBtnStyle[s]
            })
        });
        let fillBtnStyle = getComputedStyle($('#numberPadButton21')[0]);
        $('.newbtn').css({
            'font-size': fillBtnStyle['fontSize'],
        })

        /*
        let menuStyle = getComputedStyle($('#puzzleSmallMenu')[0]);
        let menuHeaderStyle = getComputedStyle($('#puzzleSmallMenu header')[0]);
        let menuH2Style = getComputedStyle($('#puzzleSmallMenu header h2')[0]);
        ['height', 'left', 'top'].forEach(s => {
            $('.newbtn').css({
                [s]: menuStyle[s],
                width: 0,
                "z-index": 3
            })
        });
        ['width', 'left', 'position', 'line-height', 'color', 'background', 'padding'].forEach(s => {
            $('.newbtn header').css({
                [s]: menuHeaderStyle[s]
            })
        });
        ['box-shadow','color', 'font-size', 'font-weight', 'height', 'text-orientation', 'text-align','writing-mode'].forEach(s => {
            $('.newbtn header h2').css({
                [s]: menuH2Style[s]
            })
        });
        reStyle();
        */
    }

    function isCorrect(){
        let oldCopyRight = document.querySelector('.puzzle-copyright li');

        requestAnimationFrame(() => {
            let msg = PUZZLE_INFO;
            oldCopyRight.style.backgroundColor = '#fff';
            oldCopyRight.style.color = '#000';
            if(enableAutoCheck){
                let solOk = window.DKS.puzzle.board.checkSolution().length === 0;
                let msgStyle = solOk ? '#28a745' : '#dc3545';
                msg = solOk ? 'CORRECT' : 'WRONG';
                msg = PUZZLE_INFO + ' - Current inputs are ' + msg;
                oldCopyRight.style.backgroundColor = msgStyle;
                oldCopyRight.style.color = 'yellow';
            }
            oldCopyRight.textContent = msg;
            //isCorrect();
        })
        /*
        let puzzleDate = info.querySelector('.date');
        puzzleNumber.addEventListener('click', () => {
            //mobile auto detect
            window.location.href = 'https://www.dailykillersudoku.com/'
        });
        */
    }

    function autoFillPencilKnownCages(){
        for(let cage of ALL_CAGES){
            //todo?: check cage.sum to filter out too many pencilmark
            let combinations = cage["combinations"]["combinations"];
            if(combinations.length > 2) continue;
            //let cellHasValue = cells.filter(c => c.value != 0)
            //if(cellHasValue) continue;

            let values = combinations.map(c => c["values"]).flat().filter((value, index, arr) => arr.indexOf(value) === index);
            let cells = cage["cells"];
            cells.filter(cell => cell.pencilMarks.length == 0).forEach(cell => cell.pencilMarks = values.slice());
        }
        reDrawBoard();
    }

    function fillAllInnieInBox(){
        for(let boxId of Object.keys(ALL_BOXS)){
            let boxIndex = +boxId.replace('box','')
            let boxRow = Math.floor(boxIndex / 3) * 3;
            let boxColumn = (boxIndex % 3) * 3
            findIO('column', boxColumn, boxColumn + 2, 1, boxRow, boxRow + 2)
        }
    }

    function find3RowCol(cell=null){
        if(cell){
            //todo
            return;
        }
        //maybe there's a better way to handle the situation where a filled number reveals a new number
        for(let dir of ['row', 'column']){
            for(let i = 0; i < 9; i += 3){
                findIO(dir, i, i + 2);
                findIO(dir, i, i + 2, true, i, i + 5);
                findIO(dir, i, i + 2, true, i + 3, 8);
            }
        }
    }

    function find2RowCol(cell=null){
        if(cell){
            let {row: curRow, column: curCol} = cell;
            findIO('row', curRow, curRow + 1);
            findIO('row', curRow, curRow - 1);
            findIO('column', curCol, curCol + 1);
            findIO('column', curCol, curCol - 1);
            return;
        }
        //maybe there's a better way to handle the situation where a filled number reveals a new number
        for(let dir of ['row', 'column']){
            for(let i = 0; i < 8; i++){
                findIO(dir, i, i + 1);
            }
        }
    }

    function findInnieRowColumn(){
        for(let i = 0; i < 9; i++){
            findIO('row', i, i);
            findIO('column', i, i);
        }
    }

    //Listeners==========================================================================================================================
    function fillRemainNumber(curCell){
        fillCage(curCell);
        fillRowCol(curCell);

        fillBoxByValue(curCell);
        fillAllInnieInBox();

        find2RowCol(curCell);
        find3RowCol(curCell);

        reDrawBoard();
    }

    function disableCombinations(cell){
        let combinations = cell.cage["combinations"]["combinations"];
        for(let comb of combinations){
            if(!comb.values.includes(cell.value) && comb.isEnabled){
                comb.isEnabled = false;
                DKS.puzzle.addCombinationToUndoList(comb)

            }
        }
        DKS.puzzle._combinations.redraw();
    }

    function fillCage(curCell){
        let remainCells = curCell.cage.cells.filter(cell => cell.value == 0 && cell.value != curCell.value);
        if(remainCells.length !== 1) return;

        let remainSum = curCell.cage.sum - curCell.cage.cells.filter(cell => cell.value != 0).map(c => c.value).reduce((acc, cur) => acc + cur, 0);

        setValue(remainCells[0], remainSum);
    }

    function fillRowCol(curCell){
        let {row, column} = curCell;
        //fill by values that already present in the row/col
        fillRowByValues(curCell);
        fillColumnByValue(curCell);
        //fill by cage.sum
        findIO('row', row, row);
        findIO('column', column, column);
    }

    function fillRowByValues(curCell){
        let allCellsInRow = ALL_CELLS[curCell.row];
        let remainCells = allCellsInRow.filter(cell => cell.value == 0);
        if(remainCells.length !== 1) return;

        let remainSum = 45 - allCellsInRow.filter(cell => cell.value != 0).map(c => c.value).reduce((acc, cur) => acc + cur, 0);
        setValue(remainCells[0], remainSum);
    }

    function fillColumnByValue(curCell){
        let allCellsInCol = ALL_CELLS.map(row => row.find(c => c.column === curCell.column));
        let remainCells = allCellsInCol.filter(cell => cell.value == 0);
        if(remainCells.length !== 1) return;

        let remainSum = 45 - allCellsInCol.filter(cell => cell.value != 0).map(c => c.value).reduce((acc, cur) => acc + cur, 0);
        setValue(remainCells[0], remainSum);
    }

    function fillBoxByValue(curCell){
        let blockX = curCell.row - curCell.row % 3;
        let blockY = curCell.column - curCell.column % 3;
        let emptyCell = null;
        let isNotEmpty = 0;
        let sum = 0;
        for(let i = 0; i < 3; i++){
            for(let j = 0; j < 3; j++){
                let cell = ALL_CELLS[blockX + i][blockY + j];
                if(cell.value != 0){
                    isNotEmpty += 1;
                    sum += cell.value;
                } else {
                    emptyCell = cell
                }
            }
        }
        if(isNotEmpty != 8){return}

        let remainSum = 45 - sum;
        setValue(emptyCell, remainSum);
    }

    function removePencilMark(num, curRow, curCol){
        let isRemoved = false;

        let cellsInRow = ALL_CELLS[curRow];
        let cellsInCol = ALL_CELLS.map(row => row[curCol]);

        cellsInRow.forEach(cell => {
            if(cell.pencilMarks.includes(num)){
                removeMark(cell, num);
                isRemoved = true;
            }
        })

        cellsInCol.forEach(cell => {
            if(cell.pencilMarks.includes(num)){
                removeMark(cell, num);
                isRemoved = true;
            }
        })

        //cage itself
        let curCellCage = ALL_CELLS[curRow][curCol]['cage']
        curCellCage.cells.forEach(cell => {
            if(cell.pencilMarks.includes(num)){
                removeMark(cell, num);
                isRemoved = true;

            }
        })


        //3x3 subgrid
        let blockX = curRow - curRow % 3;
        let blockY = curCol - curCol % 3;
        for(let i = 0; i < 3; i++){
            for(let j = 0; j < 3; j++){
                let cell = ALL_CELLS[blockX + i][blockY + j];
                if(cell.pencilMarks.includes(num)){
                    removeMark(cell, num);
                    isRemoved = true;
                }
            }
        }

        isRemoved && reDrawBoard();
    }

    function getNumberAtCurrentColumnsOrRows(cells){
        let calculateDirection = checkDirection(cells);
        let calculateValues = cells.map(c => c[calculateDirection]).sort(); //sort helps resolve weird problem with the order while selecting cells

        findIO(calculateDirection, calculateValues[0], calculateValues[calculateValues.length - 1]);

        return;
    }

    function autoAddSumCage(){
        //functor = 1: equal, 2: greater than, 0: less than, 3: less and equal than, 4: greater and equal than
        let cagesHasEqualSign = ALL_CAGES.filter(c => c.sum === 0 && c._relationships.some(r => r.functor === 1))
        cagesHasEqualSign.sort((a,b) => {a._relationships.length - b._relationships.length}).forEach(cage => {
            let equalType = cage._relationships.filter(r => r.functor === 1 && r.cage.sum !== 0);
            equalType.forEach(r => {
                addSumToCage(cage, r.cage.sum);
            })
        });
    }

    function manuallyAddSumCage(cells){
        let cage = cells[0].cage;
        let sum = prompt('Enter Cage Sum');
        if(!sum) return;
        addSumToCage(cage, sum);
        addToUndoList(cage);
        cage.hasModified = true;
    }

    function addSumToCage(cage, sum){
        let s = Number(sum);
        let combs = new window.DKS.Combinations(s, cage.cells.length, 9)
        cage.sum = s;
        cage.combinations = combs;
        //this helps redraw the cage sum on the board
        window.DKS.puzzle.onDocumentVisible();
    }

    ///HELPER=============================================================================================================================
    function ready(){
        let wait = setInterval(() => {
            if(window.DKS?.puzzle && window.DKS.onready._isReady){
                clearInterval(wait);

                PUZZLE_NUMBER = window.DKS.puzzle.id();
                PUZZLE_INFO = `${PUZZLE_NUMBER} - ${window.DKS.puzzle.difficulty()}`;
                STORAGE_KEY = 'jimmy_dks_' + PUZZLE_NUMBER;
                ALL_CAGES = window.DKS.puzzle.board._cages;
                ALL_CELLS = window.DKS.puzzle.board._cells;
                ALL_BOXS = groupCagesIntoBox();
                main();
            }
        }, 1000)
        }
    function findIO(direction, startAt, endAt, isBox = false, boxStart = 0, boxEnd = 2){
        let regionSum = (endAt - startAt + 1) * 45;

        let boxFilter = () => true;
        if(isBox){
            let opDir = direction === 'row' ? 'column' : 'row';
            regionSum = (boxEnd - boxStart + 1) * 15;
            boxFilter = c => c[opDir] >= boxStart && c[opDir] <= boxEnd
        }

        let insideFilter = c => c[direction] >= startAt && c[direction] <= endAt && boxFilter(c);
        let cagesInRegion = ALL_CAGES.filter(cage => {
            let cells = cage.cells;
            return cells.some(insideFilter)
        });

        let remain = sumCages(cagesInRegion) - regionSum;
        if(remain < 1) return;

        let cagesInside = cagesInRegion.filter(cage => {
            let cells = cage.cells;
            return cells.every(insideFilter)
        });
        let cagesOutside = cagesInRegion.filter(cage => !cagesInside.includes(cage)) ;
        let emptyCellsOutside = cagesOutside.map(cage => {
            let cells = cage.cells;
            return cells.filter(c => !insideFilter(c))
        }).flat();
        let sumCellsOutside = emptyCellsOutside.reduce((total, cell) => total + cell.value ?? 0, 0);
        let remainOutie = remain - sumCellsOutside;

        let cellsHasNoValue = emptyCellsOutside.filter(cell => !!!cell.value);
        if(cellsHasNoValue.length === 1 && remainOutie > 0 && remainOutie < 10){
            setValue(cellsHasNoValue[0], remainOutie)
            return;
        }

        let emptyCellsInside = cagesOutside.map(cage => {
            let cells = cage.cells;
            return cells.filter(c => !emptyCellsOutside.includes(c))
        }).flat();
        let remainInnie = sumCages(cagesOutside) - (sumCages(cagesInRegion) - regionSum) - emptyCellsInside.reduce((total, cell) => total + cell.value ?? 0, 0);

        cellsHasNoValue = emptyCellsInside.filter(cell => !!!cell.value);
        if(cellsHasNoValue.length === 1 && remainInnie > 0 && remainInnie < 10){
            setValue(cellsHasNoValue[0], remainInnie)
            return;
        }
    }

    function getBlockIndex(r, c){
        return Math.floor(c / 3) + r - r % 3;
    }

    function sumCages(cages){
        return cages.map(c => c.sum === 0 ? -Infinity : c.sum).reduce((acc, cur) => acc + cur, 0);
    }

    function checkDirection(cells){
        if(cells.length < 2){
            alert('This func used for at least 2 cells');
            return;
        }
        let [fcell, scell] = cells;

        let direction = 'column';
        if(fcell.row - scell.row != 0){
            direction = 'row';
        }

        return direction;
        /*
        let r = 1;
        let direction = 'column';
        while(r < cells.length){
            if(cells[r].row - cells[r - 1].row != 0){
                direction = 'row';
                break;
            }
            r++
        }
        return direction;
        */
    }

    function showWarning(){
        window.DKS.modal.info("Cannot find combinations, plz check again")
    }

    function setValue(cell, value){
        if(value < 1 || value > 9) return;
        addToUndo(cell);
        cell.pencilMarks = [];
        cell.toggleValue(value, false);
    }

    function reDrawBoard(){
        //So that it will update after filling pencil or value
        window.DKS.puzzle.board.renderCells()
    }

    function addToUndo(cell){
        let combinations = cell.cage["combinations"]["combinations"];
        for(let comb of combinations){
            if(!comb.values.includes(cell.value)){
                //comb.isEnabled = false;
                DKS.puzzle.addCombinationToUndoList(comb)

            }
        }
        window.DKS.puzzle.addCellsToUndoList([cell]) //do I need this?
    }

    function removeMark(cell, num){
        if(cell.pencilMarks.length === 0 || cell.value > 0) return;
        addToUndo(cell);
        cell.pencilMarks.splice(cell.pencilMarks.indexOf(num), 1);
        if(cell.pencilMarks.length == 1){
            setValue(cell, cell.pencilMarks[0], false);
        }
        if(cell.pencilMarks.length == 1){
            setValue(cell, cell.pencilMarks[0], false);
        }
    }

    function groupCagesIntoBox(){
        let box = {};
        ALL_CAGES.forEach(cage => putAllCellsInItsBox(cage.cells));
        function putAllCellsInItsBox(cells){
            let s = new Set();
            let idx = -1;
            cells.forEach(c => {
                let {row, column} = c;
                idx = getBlockIndex(row, column);
                s.add(idx)
            });
            if(s.size === 1){
                let boxId = 'box' + idx;
                if(box[boxId] == undefined){
                    box[boxId] = [];
                }
                box[boxId].push(cells[0].cage);
            }
        }



        return box;;
    }

    function reStyle(){
        let tabStyle = `

        @media (max-width: 767.97px)  {

html.touchscreen-layout .content .puzzle-page-container header {
    height: 25%;
}

html.touchscreen-layout .content .combinations-container header {
    top: 0
}

html.touchscreen-layout .content .calculator-container header {
    top: 25%
}

html.touchscreen-layout .content .sm-puzzle-menu header {
    top: 50%;
}

html.touchscreen-layout .content .${toggleBtnIdentifier} header {
    top: 75%
}
}
@media (min-width: 700px) and (orientation: landscape) {
           .${toggleBtnIdentifier} {display: none}
        }
    `;
        $('body').append($('<style class="' + toggleBtnIdentifier + '">' + tabStyle + '</style>'))
    }

    /*
    function getOutieInnieSummary(cells){
        let direction = checkDirection(cells);
        let calculateValues = cells.map(c => c[direction]);

        let startAt = calculateValues[0];
        let endAt = calculateValues[calculateValues.length - 1];
        let regionSum = (endAt - startAt + 1) * 45;

        let boxFilter = () => true;

        let insideFilter = c => c[direction] >= startAt && c[direction] <= endAt && boxFilter(c);
        let cagesInRegion = ALL_CAGES.filter(cage => {
            let cells = cage.cells;
            return cells.some(insideFilter)
        });

        let outie = sumCages(cagesInRegion) - regionSum;

        let cagesInside = cagesInRegion.filter(cage => {
            let cells = cage.cells;
            return cells.every(insideFilter)
        });
        let cagesOutside = cagesInRegion.filter(cage => !cagesInside.includes(cage)) ;


        let innie = sumCages(cagesOutside) - outie;

        let klassSel = 'jimmy_info';
        $('.' + klassSel).remove();
        $(`<div class="${klassSel}">Innie: ${innie} - Outie: ${outie}</div>`).insertAfter($('.info'));
    }
    */

    /*
    function getNumberAtCurrentCell(cell){
        //outnie
        let boxes = groupCagesIntoBox();
        let boxId = 'box' + getBlockIndex(cell.row, cell.column);

        let cages = boxes[boxId];
        let remain = 45 - sumCages(cages);

        if(remain < 10){
            cell.pencilMarks = [];
            cell.toggleValue(remain, false);
            reDrawBoard();
        }
        //a = new DKS.Combinations(sum,size,9)
   }
   */


})();
