'use strict';

import {
    Div,
    ClientLocation,
    Button
} from '@src/classes';

interface PopupData {
    title?: string;
    class?: string;
    message?: string;
    cancelText?: string;
    validText?: string;
    cancelRed?: boolean;
    cancelGreen?: boolean;
    validRed?: boolean;
    validGreen?: boolean;
    noButtons?: boolean;
    validDisabled?: boolean;
    cancellable?: boolean;
    empty?: boolean;
    ready?: boolean;
    notRemovable?: boolean;
    closeZoneHidden?: boolean;
    hasCloseIcon?: boolean;
}

export class Popup extends Div {

    public box: Div;
    public content: Div;
    public cancelButton: Button;
    public validButton: Button;
    protected container: Div;

    constructor(public data: PopupData) {

        super('popup', ClientLocation.get().block);
        
        this.drawCloseZone();
        this.drawContainer();
        this.drawBox();
        this.show();
    }

    /*
    **
    **
    */
    private drawCloseZone() : void {

        if (!this.data.closeZoneHidden) {
        
            const closeZone = new Div('close-zone', this);

            if (!this.data.notRemovable)
                closeZone.onNative('click', this.hide.bind(this));

            setTimeout(() => {
                closeZone.setData('displayed', 1);
            }, 100);
        }
    }
    
    /*
    **
    **
    */
    private drawContainer() : void {

        this.container = new Div('container light-zone', this);
    }

    /*
    **
    **
    */
    private drawBox() : void {

        this.box = new Div('box', this.container);
        
        if (this.data.class)
            this.addClass(this.data.class);

        if (this.data.empty)
            return;

        //=====
        //TITLE
        //=====

        if (this.data.title) {
        
            const title = new Div('title', this.box).write(this.data.title);
            
            if (this.data.hasCloseIcon)
                new Div('close-icon', title).onNative('click', this.hide.bind(this));
        }

        //=========================
        //SIMPLE MESSAGE OR CONTENT
        //=========================

        if (this.data.message)
            new Div('message', this.box).html(this.data.message);
        else
            this.content = new Div('content', this.box);

        //=======
        //BUTTONS
        //=======

        if (!this.data.noButtons) {

            const buttons = new Div('buttons', this.box);

            let cancelClass = 'cancel';
            if (this.data.cancelGreen)
                cancelClass = 'green';
            else if (this.data.cancelRed)
                cancelClass = 'red';

            let validClass = 'valid';
            if (this.data.validGreen)
                validClass += ' green';
            else if (this.data.validRed)
                validClass += ' red';

            if (this.data.cancellable) {

                this.cancelButton = new Button({
                    label: this.data.cancelText ? this.data.cancelText : 'Cancel',
                    class: cancelClass,
                }, buttons).onNative('click', this.onCancel.bind(this));
            }
            
            
            this.validButton = new Button({
                label: this.data.validText ? this.data.validText : 'Valid',
                class: validClass
            }, buttons).onNative('click', this.onValid.bind(this));
                
            if (this.data.validDisabled)
                this.validButton.disable();
        }

        //==========
        //FAST READY
        //==========

        if (this.data.ready)
            this.ready();
    }

    /*
    **
    **
    */
    public async onValid() : Promise<void> {

        this.hide();
    }

    /*
    **
    **
    */
    public async onCancel() : Promise<void> {

        this.hide();
    }

    /*
    **
    **
    */
    public lock() : void {

        this.setData('locked', 1);
    }
    
    /*
    **
    **
    */
    public unlock() : void {

        this.cancelButton.unload();
        this.validButton.unload();
        this.setData('locked', 0);
    }

    /*
    **
    **
    */
    public show() : void {
        
        setTimeout(function() {

            this.setData('on', 1);

            setTimeout(function() {
                this.setData('displayed', 1);
            }.bind(this), 100);
        
        }.bind(this), 50);
    }

    /*
    **
    **
    */
    public hide() : void {

        this.setData('displayed', 0);

        setTimeout(function() {
            this.setData('on', 0);
            setTimeout(function() {
                this.delete();
            }.bind(this), 200);
        }.bind(this), 100);

        this.emit('hide');
    }

    /*
    **
    **
    */
    protected ready() : void {
        
        this.setData('content-loaded', 1);
    }
}