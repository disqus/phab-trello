# phab-trello
Phabricator-to-Trello Webhook

Disqus uses Phabricator for our version control, and we use Trello for our scrum & task management.  There was no integration between these tools, so we created one.

We decided to use webhooks rather than the Phabricator API, so that we could preserve separation of concerns and keep our Phabricator server from being directly exposed.

## Install

* Download this repo
* Install dependencies using `npm install`
* Create the database schema:
  * `psql your_database_name < schema.sql`
* Open up *run-server-example.sh*, copy to *run-server.sh* and set the values within:
  * PHAB_TOKEN: get this at `https://YOUR_PHABRICATOR_URL.com/settings/user/YOUR_USERNAME/page/apitokens`
  * TRELLO_KEY & TRELLO_TOKEN: get these [here](https://trello.com/app-key)
* Run the server using `./run-server.sh`.
* In your Phabricator config, add a `http-hooks` value which points at your server.
* Head over to the [trello-phab repo](http://github.com/disqus/trello-phab) to install the Trello Power-Up.
