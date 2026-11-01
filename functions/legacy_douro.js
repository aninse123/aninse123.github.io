// TEMPORARY (Phase 0, deleted in WP10): Douro's own settings, used only while
// instance/settings has not been seeded in the douro-partners project, so no
// deploy order can lock anyone out or change how email is sent. Any other
// project fails closed and never reads this. A test keeps it equal to
// instances/douro/instance.json.
module.exports = {
  "settings": {
    "adminEmails": [
      "andre.rocha@douropartners.pt"
    ],
    "founders": [
      {
        "email": "andre.rocha@douropartners.pt",
        "key": "andre",
        "name": "André Rocha"
      },
      {
        "email": "antonio.carvalho@douropartners.pt",
        "key": "antonio",
        "name": "António Carvalho"
      }
    ],
    "portalOrigins": [
      "https://douropartners.pt",
      "https://www.douropartners.pt",
      "https://staging--douro-partners.netlify.app"
    ],
    "noreplyFrom": "Douro Partners <noreply@douropartners.pt>",
    "productionHosts": [
      "douropartners.pt",
      "www.douropartners.pt"
    ],
    "outreach": {
      "senderDomain": "mail.douropartners-team.pt",
      "relationshipDomain": "douropartners.pt",
      "unsubscribeBaseUrl": "https://douropartners.pt/u/",
      "ccDomains": [
        "douropartners.pt",
        "mail.douropartners-team.pt"
      ],
      "testRecipients": [
        "andrenorocha@gmail.com",
        "andrerochaaero@gmail.com",
        "amobnc92@gmail.com",
        "douropartners.team@gmail.com",
        "andre.rocha@douropartners.pt",
        "antonio.carvalho@douropartners.pt",
        "andre.rocha@mail.douropartners-team.pt",
        "a.rocha@mail.douropartners-team.pt",
        "an.rocha@mail.douropartners-team.pt",
        "rocha.andre@mail.douropartners-team.pt",
        "antonio.carvalho@mail.douropartners-team.pt",
        "a.carvalho@mail.douropartners-team.pt",
        "an.carvalho@mail.douropartners-team.pt",
        "carvalho.antonio@mail.douropartners-team.pt",
        "andre.rocha@douropartners-team.pt",
        "antonio.carvalho@douropartners-team.pt",
        "delivered@resend.dev",
        "bounced@resend.dev",
        "complained@resend.dev",
        "suppressed@resend.dev"
      ],
      "seedSenders": [
        {
          "local": "an.rocha",
          "owner": "andre",
          "displayName": "André Rocha",
          "status": "active"
        },
        {
          "local": "rocha.andre",
          "owner": "andre",
          "displayName": "André Rocha",
          "status": "paused"
        },
        {
          "local": "andre.rocha",
          "owner": "andre",
          "displayName": "André Rocha",
          "status": "warming"
        },
        {
          "local": "a.rocha",
          "owner": "andre",
          "displayName": "André Rocha",
          "status": "warming"
        },
        {
          "local": "an.carvalho",
          "owner": "antonio",
          "displayName": "António Carvalho",
          "status": "paused"
        },
        {
          "local": "carvalho.antonio",
          "owner": "antonio",
          "displayName": "António Carvalho",
          "status": "paused"
        },
        {
          "local": "antonio.carvalho",
          "owner": "antonio",
          "displayName": "António Carvalho",
          "status": "warming"
        },
        {
          "local": "a.carvalho",
          "owner": "antonio",
          "displayName": "António Carvalho",
          "status": "warming"
        }
      ],
      "relationshipSenders": [
        {
          "email": "andre.rocha@douropartners.pt",
          "owner": "andre",
          "displayName": "André Rocha"
        },
        {
          "email": "antonio.carvalho@douropartners.pt",
          "owner": "antonio",
          "displayName": "António Carvalho"
        },
        {
          "email": "noreply@douropartners.pt",
          "owner": null,
          "displayName": "Douro Partners"
        }
      ],
      "signatureLines": [
        "Douro Partners",
        "www.douropartners.pt"
      ]
    }
  },
  "public": {
    "orgName": "Douro Partners",
    "logoUrl": "https://douropartners.pt/assets/logo-transparent.png",
    "portalUrl": "https://douropartners.pt/portal/",
    "contacts": [
      {
        "name": "André",
        "email": "andre.rocha@douropartners.pt"
      },
      {
        "name": "António",
        "email": "antonio.carvalho@douropartners.pt"
      }
    ]
  }
};
