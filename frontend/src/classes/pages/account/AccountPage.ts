'use strict';

import {
    TitledPage,
    Div,
    ClientLocation,
} from '@src/classes';

export class AccountPage extends TitledPage {

    constructor() {

        super('My Account', 'account');
        this.build();
    }

    /*
    **
    **
    */
    private build() : void {

        const account = ClientLocation.get().api.accountData;

        const main = new Div('', this.content);
        main.setStyle('padding', '20px');

        // ── User info ─────────────────────────────────────────────────
        const card = new Div('light-zone', main);
        card.setStyles({ 'padding': '20px', 'display': 'flex', 'align-items': 'center', 'gap': '16px', 'margin-bottom': '16px' });

        if (account?.picture) {
            const avatar = new Div('', card);
            avatar.element.innerHTML = `<img src="${account.picture}" referrerpolicy="no-referrer" style="width:56px;height:56px;border-radius:50%;object-fit:cover;" />`;
        }

        const info = new Div('', card);

        const name = new Div('', info);
        name.setStyles({ 'font-size': '16px', 'font-weight': '600', 'margin-bottom': '4px' });
        name.write(account?.name || '—');

        const email = new Div('', info);
        email.setStyles({ 'font-size': '13px', 'color': 'rgba(0,0,0,0.5)' });
        email.write(account?.email || '—');

        // ── Subscription (placeholder) ────────────────────────────────
        const subCard = new Div('light-zone', main);
        subCard.setStyle('padding', '20px');

        const subTitle = new Div('', subCard);
        subTitle.setStyles({ 'font-size': '13px', 'font-weight': '600', 'color': 'rgba(0,0,0,0.5)', 'text-transform': 'uppercase', 'letter-spacing': '0.04em', 'margin-bottom': '12px' });
        subTitle.write('Subscription');

        const subStatus = new Div('', subCard);
        subStatus.setStyles({ 'font-size': '14px', 'color': 'rgba(0,0,0,0.75)' });
        subStatus.write('Free tier — subscription management coming soon.');
    }
}
