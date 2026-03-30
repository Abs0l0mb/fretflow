'use strict';

import {
    AbstractClient,
    ApiRequestsManager,
    Navigation,
    Tools
} from '@src/classes';

import {
    TabifyPage,
    LoginPage,
    AccountPage,
} from '@src/classes';

export interface AppData {
    [key: string]: any;
}

declare const __STORE_AppData__: number[];

export class Client extends AbstractClient {

    private appData: AppData = Client.u(__STORE_AppData__);

    public readonly rootPath: string = '';

    public navigation: Navigation;
    
    private popupWindow: Window | null = null;

    constructor() {

        super({
            fonts: ['Inter:300,400,500,600,700,800,900']
        });
    }

    /*
    **
    **
    */
    public async beforeInit() : Promise<void> {
    }

    /*
    **
    **
    */
    public async afterInit() : Promise<void> {

        this.navigation = new Navigation();

        this.block.prepend(this.navigation);
    }

    /*
    **
    **
    */
    public onNotConnected() : void {

        this.router.setRoutes({
            '/': LoginPage
        });

        this.router.route('/');

        this.setNavigationAvailability(false);
    }

    /*
    **
    **
    */
    public async onConnected() : Promise<void> {

        this.router.setRoutes({
            '/':        TabifyPage,
            '/account': AccountPage,
        });

        ApiRequestsManager.lock();
        this.router.routeCurrentPath();
        ApiRequestsManager.unlock();

        this.setNavigationAvailability(!this.isPopup());
    }

    /*
    **
    **
    */
    private setNavigationAvailability(availability: boolean) : void {

        this.block?.setData('navigation-available', availability ? 1 : 0);
    }

    /*
    **
    **
    */
    static u/*npackStoredData*/(input: number[]) : any {

        let bytes: number[] = [];

        const step = 31;
        let i = 1;
        for (const byte of input) {
            i++;
            if (i > step)
                i=1;
            bytes.push(byte - step - i);
        }

        return JSON.parse(Tools.arrayBufferToString(new Uint8Array(bytes)));
    }

    /*
    **
    **
    */
    private getSettings() : any {

        try {

            const settings = JSON.parse(localStorage.getItem('settings')!);

            if (typeof settings !== 'object' || settings === null)
                throw null;

            return settings;
        }
        catch(exception) {

            this.setSettings({});

            return {};
        }
    }

    /*
    **
    **
    */
    private setSettings(settings: any) : void {
        
        try {

            localStorage.setItem('settings', JSON.stringify(settings));
        }
        catch(exception) {
            
            localStorage.setItem('settings', JSON.stringify({}));
        }
    }

    /*
    **
    **
    */
    private getSetting(key: string) : any {

        const settings = this.getSettings();

        return settings[key];
    }

    /*
    **
    **
    */
    private setSetting(key: string, value: any) : void {

        const settings = this.getSettings();

        settings[key] = value;

        this.setSettings(settings);
    }

    /*
    **
    **
    */
    public getPopupWindow() : Window | null {

        return this.popupWindow;
    }

    /*
    **
    **
    */
    public setPopupWindow(popupWindow: Window) : void {

        this.popupWindow = popupWindow;
    }

    /*
    **
    **
    */
    public isPopup() : boolean {

        return window.opener && window.opener !== window;
    }
}