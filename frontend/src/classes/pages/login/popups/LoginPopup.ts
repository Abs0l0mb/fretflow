'use strict';

import {
    Div,
    Popup,
    Button,
    TextInput,
    Api,
    ClientLocation,
    PasswordInput,
    Form,
    FormField
} from '@src/classes';

export class LoginPopup extends Popup {

    private form: Form;
    private email:    FormField;
    private password: FormField;

    constructor() {

        super({
            title: 'Sign in to Tabify',
            closeZoneHidden: true,
            notRemovable: true,
            validDisabled: false,
        });

        this.addClass('login small');
        this.drawContent();
    }

    /*
    **
    **
    */
    private drawContent() : void {

        const appData = new Div('app-data', this.container);
        new Div('logo', appData);

        const body = new Div('login-body', this.content);
        body.setStyles({
            'display':        'flex',
            'flex-direction': 'column',
            'align-items':    'center',
            'gap':            '12px',
            'padding':        '24px 16px',
            'width':          '100%',
            'box-sizing':     'border-box',
        });

        const subtitle = new Div('', body);
        subtitle.setStyles({ 'color': 'rgba(0,0,0,0.5)', 'font-size': '14px', 'text-align': 'center' });
        subtitle.write('Convert MIDI files to Guitar Pro tabs');

        // ── Google button ─────────────────────────────────────────────
        const googleBtn = new Button({ label: 'Sign in with Google' }, body);
        googleBtn.setStyles({ 'width': '100%', 'max-width': '280px', 'justify-content': 'center' });
        googleBtn.onNative('click', () => {
            window.location.href = `${Api.getBaseURL().origin}/api/auth/google`;
        });

        // ── Separator ─────────────────────────────────────────────────
        const sep = new Div('', body);
        sep.setStyles({
            'display':      'flex',
            'align-items':  'center',
            'gap':          '8px',
            'width':        '100%',
            'max-width':    '280px',
            'color':        'rgba(0,0,0,0.3)',
            'font-size':    '12px',
        });
        new Div('', sep).setStyles({ 'flex': '1', 'height': '1px', 'background': 'rgba(0,0,0,0.1)' });
        new Div('', sep).write('or');
        new Div('', sep).setStyles({ 'flex': '1', 'height': '1px', 'background': 'rgba(0,0,0,0.1)' });
        
        this.form = new Form(this.content);

        //=====
        //EMAIL
        //=====

        this.email = this.form.add(new TextInput({
            label: 'Email'
        }));

        this.email.linkToErrorKey('email');
        this.email.input.detectAutoFill();

        //========
        //PASSWORD
        //========

        this.password = this.form.add(new PasswordInput({
            label: 'Password'
        }));

        this.password.linkToErrorKey('password');
        this.password.input.detectAutoFill();

        this.form.on('enter-down', this.onValid.bind(this));

        this.ready();
    }

    /*
    **
    **
    */
    public async onValid() : Promise<void> {

        this.validButton.load();

        const email    = this.email.input.getValue().trim();
        const password = this.password.input.getValue();

        if (!email || !password) {
            this.form.displayError('Please fill in all fields.');
            this.validButton.unload();
            return;
        }

        try {
            await Api.post('/auth/login', { email, password });
            await ClientLocation.get().api.checkAuth();
            this.hide();
        } catch (error: any) {
            this.form.displayError('Invalid email or password');
            this.validButton.unload();
        }
    }
}
