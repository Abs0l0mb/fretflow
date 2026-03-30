'use strict';

import {
    Div,
    Block,
    ClientLocation,
    ContextMenu,
    Api,
    Menu,
    Tools
} from '@src/classes';

export class Navigation extends Div {

    private menu: Menu;
    private reduced: boolean = false;
    private userBadge: Div | null = null;

    constructor() {
        
        super('navigation');

        this.draw();
        
        ClientLocation.get().api.on('connected', this.onConnected.bind(this));
        ClientLocation.get().api.on('not-connected', this.onNotConnected.bind(this));

        setTimeout(function() {
            this.setData('displayed', 1);
        }.bind(this), 50);
    }

    /*
    **
    **
    */
    private async drawMenu() : Promise<void> {

        if (this.menu)
            this.menu.empty();

        this.menu = new Menu([

            { label: 'Tools', extraClass: 'settings', submenuOpened: true, submenu: [
                { label: 'MIDI to tabs', path: '/', extraClass: 'tasks' },
            ]},

        ], this);

        await this.menu.draw();

        this.menu.on('item-click', () => {
            this.setMobileMenuVisibility(false);
        });

        if (this.getNavigationReducedSetting())
            this.reduce();
    }

    /*
    **
    **
    */
    private async onConnected() : Promise<void> {

        await this.drawMenu();
        this.drawUserBadge();

        this.setMobileMenuVisibility(false);
    }

    /*
    **
    **
    */
    private drawUserBadge() : void {

        if (this.userBadge)
            this.userBadge.delete();

        const account = ClientLocation.get().api.accountData;
        if (!account) return;

        this.userBadge = new Div('user-badge', ClientLocation.get().block);
        this.userBadge.setStyles({
            'position':      'fixed',
            'top':           '4px',
            'right':         '16px',
            'display':       'flex',
            'align-items':   'center',
            'gap':           '8px',
            'z-index':       '100',
            'background':    'rgba(255,255,255,0.9)',
            'border':        '2px solid rgba(155,0,0,1)',
            'border-radius': '999px',
            'padding':       '4px 12px 4px 4px',
            'box-shadow':    '0 1px 4px rgba(0,0,0,0.08)',
            'cursor':        'default',
        });

        if (account.picture) {
            const avatar = new Block('img', { src: account.picture, referrerpolicy: 'no-referrer' }, this.userBadge);
            avatar.setStyles({
                'width':        '28px',
                'height':       '28px',
                'border-radius':'50%',
                'object-fit':   'cover',
            });
        }

        const name = new Div('', this.userBadge);
        name.setStyles({ 'font-size': '13px', 'font-weight': '500', 'color': 'rgba(0,0,0,0.75)' });
        name.write(account.name || account.email);

        this.userBadge.setStyle('cursor', 'pointer');
        this.userBadge.onNative('click', (e: MouseEvent) => {
            new ContextMenu(e.clientX, e.clientY, [
                {
                    text: 'My account',
                    callback: () => ClientLocation.get().router.route('/account'),
                },
                {
                    text: 'Log out',
                    callback: async () => {
                        await Api.post('/auth/logout');
                        window.location.reload();
                    },
                },
            ]);
        });
    }
    
    /*
    **
    **
    */
    private async onNotConnected() : Promise<void> {

        this.setMobileMenuVisibility(false);

        if (this.userBadge) {
            this.userBadge.delete();
            this.userBadge = null;
        }

        if (this.menu) {
            await Tools.sleep(350);
            this.menu.delete();
        }
    }

    /*
    **
    **
    */
    private draw() : void {

        const background = new Div('background', this).onNative('click', () => {
            this.setMobileMenuVisibility(false);
        });

        new Div('mask', background).onNative('click', async () => {
            
            this.enlarge();            
        });

        new Div('mobile-button menu-button', this).onNative('click', () => {
            parseInt(this.getData('mobile-menu-displayed')) === 1 ? this.setMobileMenuVisibility(false) : this.setMobileMenuVisibility(true);
        });

        new Div('logo', this)
        .onNative('click', () => {
            ClientLocation.get().router.routeFirstPath()
        });
    }
    
    /*
    **
    **
    */
    private setMobileMenuVisibility(visibility: boolean) : void {

        this.setData('mobile-menu-displayed', visibility ? 1 : 0);
    }

    /*
    **
    **
    */
    private getNavigationReducedSetting() : boolean {

        const setting = ClientLocation.get().getSetting('navigation-reduced');

        if (typeof setting === 'boolean')
            return setting;
        else {
            this.setNavigationReducedSetting(false);
            return false;
        }
    }

    /*
    **
    **
    */
    private setNavigationReducedSetting(value: boolean) : void {

        ClientLocation.get().setSetting('navigation-reduced', value);
    }

    /*
    **
    **
    */
    private reduce() : void {

        ClientLocation.get().block.setData('navigation-reduced', 1);
        this.reduced = true;
        this.menu.reduce();

        this.setNavigationReducedSetting(true);
    }

    /*
    **
    **
    */
    private enlarge() : void {

        ClientLocation.get().block.setData('navigation-reduced', 0);
        this.reduced = false;
        this.menu.enlarge();

        this.setNavigationReducedSetting(false);
    }

    /*
    **
    **
    */
    public async refresh() : Promise<void> {

        this.menu.refresh();
    }
}