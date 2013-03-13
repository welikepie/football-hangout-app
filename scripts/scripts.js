/*jshint bitwise:false, debug:true */
/*global _:true, bean:true, Box2D:true, gapi:true, _gaq:true */
/* SHARED STATE:
 * gameState - Global state of the game (these are propagated):
 *             0 - no game is started
 *             1 - game is currently played
 *             2 - game has finished
 * score|ID  - Score for individual players
 * lastScore - Timestamp of last scoring
 */

/* LOCAL STATE:
 * gameState - Local game state:
 *             0 - same as Global
 *             1 - same as Global
 *             2 - same as Global
 *             3 - game was lost locally (ball lost), needs to wait until the end
 *             4 - late join to the game, needs to wait until the end
 */
window.init = function () {
	"use strict";

	window.requestAnimationFrame = (function (undefined) {
		return window.requestAnimationFrame ||
			window.webkitRequestAnimationFrame ||
			window.mozRequestAnimationFrame ||
			function (callback) { window.setTimeout(function () { callback((new Date()).getTime()); }, 1000 / 60); };
	})();

	var game = (function (undefined) {

		/* EVENTS:
		 * onGameStart   - fired when the game starts
		 * onGameEnd     - fired when the game ends
		 * onGameLost    - fired when the user loses the ball
		 * onLateJoin    - fired for users joining the game late
		 * 
		 * onPointScored - fired when someone scores
		 * onPlayerDrop  - fired when a player decides to drop
		 */

		var localState = 0,
			localScores = {},

			result = {

				'state': {

					'get': function getState () {
						return localState;
					},
					'set': function setState (state) {
						state = parseInt(state, 10);
						console.log('State set: ', state);
						if (localState !== state) {
							localState = state;
							bodyTag.className = 'state-' + localState;
							switch (localState) {
								case result.state.PLAYING:
									bean.fire(result, 'onGameStart');
									break;
								case result.state.ENDED:
									bean.fire(result, 'onGameEnd');
									break;
								case result.state.LOST:
									bean.fire(result, 'onGameLost');
									break;
								case result.state.LATEJOIN:
									bean.fire(result, 'onLateJoin');
									break;
							}
						}
					},

					'IDLE': 0,
					'PLAYING': 1,
					'ENDED': 2,
					'LOST': 3,
					'LATEJOIN': 4

				},

				'scores': {

					'get': function getScores () {
						return _.clone(localScores);
					},
					'set': function setScores (scores) {
						_.extend(
							localScores,
							_.chain(scores)
								.pairs()
								.map(function (item) {
									return [
										item[0].replace(/^score\|/i, ''),
										parseInt(item[1], 10)
									];
								})
								.object()
								.value()
						);
					},

					'init': function initScores (players) {
						result.scores.reset();
						_.each(players, function (player) { localScores[player] = 0; });
					},

					'reset': function resetScores () {
						var x;
						for (x in localScores) { if (_.has(localScores, x)) {
							delete localScores[x];
						} }
					},

					'remove': function removeScore (player) {
						if (_.has(localScores, player)) {
							delete localScores[player];
						}
					}

				},

				'lastScore': 0

			};

		return result;

	}()),
	lastSharedState = {},
	bodyTag = document.getElementsByTagName('body')[0],

	physics = {
		'world': null,
		'head_tracker': null,
		'ball': null,
		'track_joint': null,
		'track_joint_def': null,
		'gravity': 16,
		'gravity_vector': null,

		'scaling_map': {
			0.06: 25,
			0.09: 20,
			0.135: 15,
			0.2: 10
		},
		'last_scale': null,

		'ball_overlay': null,
		'ball_overlay_res': null,

		'area_width': null,
		'area_height': null,
		'unit_width': null,
		'unit_height': null,

		'createTracker': function createTracker () {

			var tracker_position,
				tracker_velocity,
				tracker_joint_present = false,

				body_def = new Box2D.Dynamics.b2BodyDef(),
				fixture_def = new Box2D.Dynamics.b2FixtureDef();

			// Remove current bodies from simulation, if already present
			if (physics.head_tracker) {
				tracker_position = physics.head_tracker.GetWorldCenter();
				tracker_velocity = physics.head_tracker.GetLinearVelocity();
				if (physics.track_joint) {
					tracker_joint_present = true;
					physics.world.DestroyJoint(physics.track_joint);
					physics.track_joint = null;
				}
				physics.world.DestroyBody(physics.head_tracker); physics.head_tracker = null;
			}

			if (physics.last_scale) {

				fixture_def.filter = new Box2D.Dynamics.b2FilterData();
				fixture_def.friction = 0.5;
				fixture_def.restitution = 1;

				// Set up and create Head Tracker
				body_def.type = Box2D.Dynamics.b2Body.b2_dynamicBody;
				body_def.bullet = true;
				body_def.allowSleep = false;
				body_def.fixedRotation = true;		// Prevents the head tracker from rotation - Breakout-paddle-style
				body_def.linearDamping = 1;			// Makes it so that the head tracker stops to halt when without tracking data

				if (tracker_position) { body_def.position = tracker_position; }
				else { body_def.position = new Vector(physics.area_width / 2, physics.area_height * 2 / 3); }

				if (tracker_velocity) { body_def.linearVelocity = tracker_velocity; }
				else { body_def.linearVelocity = nullVector; }

				//fixture_def.filter.categoryBits = 2;	// Category only for head tracker, only static elements should collide with it
				//fixture_def.filter.maskBits = 1;		// Ensures that the head tracker only collides with static elements
				fixture_def.shape = new Box2D.Collision.Shapes.b2PolygonShape();
				fixture_def.shape.SetAsBox(physics.unit_width * 2.5, physics.unit_width);
				fixture_def.density = 999;

				physics.head_tracker = physics.world.CreateBody(body_def);
				physics.head_tracker.CreateFixture(fixture_def);

				if (tracker_joint_present) { physics.createJoint(); }

			}

		},
		'createBall': function createBall () {

			var ball_position,
				ball_velocity,
				body_def = new Box2D.Dynamics.b2BodyDef(),
				fixture_def = new Box2D.Dynamics.b2FixtureDef();

			if (physics.ball) {

				ball_position = physics.ball.GetWorldCenter();
				ball_velocity = physics.ball.GetLinearVelocity();
				physics.world.DestroyBody(physics.ball); physics.ball = null;

			}

			if (physics.last_scale) {

				// Set up and create the ball
				body_def.type = Box2D.Dynamics.b2Body.b2_dynamicBody;
				body_def.fixedRotation = false;
				body_def.linearDamping = 0;

				if (ball_position) { body_def.position = ball_position; }
				else { body_def.position = new Vector(physics.area_width / 2, physics.area_height / 3); }

				if (ball_velocity) { body_def.linearVelocity = ball_velocity; }
				else { body_def.linearVelocity = nullVector; }

				fixture_def.friction = 0.5;
				fixture_def.restitution = 1;
				fixture_def.shape = new Box2D.Collision.Shapes.b2CircleShape();
				fixture_def.shape.SetRadius(physics.unit_width * 1.25);
				fixture_def.density = 1;

				physics.ball = physics.world.CreateBody(body_def);
				physics.ball.CreateFixture(fixture_def);

				// Calculate gravity vector based on new ball
				physics.gravity_vector = new Vector(0, physics.gravity * physics.ball.GetMass());

				// If overlay exists, adjust its size, else create new one
				if (physics.ball_overlay) {
					physics.ball_overlay.setScale(
						5 / physics.last_scale,
						gapi.hangout.av.effects.ScaleReference.WIDTH
					);
				} else {

					if (physics.ball_overlay_res.isLoaded()) {

						physics.ball_overlay = physics.ball_overlay_res.createOverlay({
							'position': {
								'x': (body_def.position.x / physics.area_width) - 0.5,
								'y': (body_def.position.y / physics.area_height) - 0.5
							},
							'scale': {
								'magnitude': 3 / physics.last_scale,
								'reference': gapi.hangout.av.effects.ScaleReference.WIDTH
							}
						});
						physics.ball_overlay.setVisible(true);

					} else {

						physics.ball_overlay = {
							'setScale': function () {},
							'setPosition': function () {}
						};
						physics.ball_overlay_res.onLoad.add(function (ev) {

							var pos = physics.ball.GetWorldCenter();
							physics.ball_overlay = physics.ball_overlay_res.createOverlay({
							'position': {
								'x': (pos.x / physics.area_width) - 0.5,
								'y': (pos.y / physics.area_height) - 0.5
							},
							'scale': {
								'magnitude': 3 / physics.last_scale,
								'reference': gapi.hangout.av.effects.ScaleReference.WIDTH
							}
							});
							physics.ball_overlay.setVisible(true);
						});

					}

				}

			}

		},
		'destroyTracker': function destroyTracker () {

			if (physics.track_joint) { physics.destroyJoint(); }
			if (physics.head_tracker) {
				physics.world.DestroyBody(physics.head_tracker);
				physics.head_tracker = null;
			}

		},
		'destroyBall': function destroyBall () {

			if (physics.ball_overlay) { physics.ball_overlay.dispose(); physics.ball_overlay = null; }
			if (physics.ball) { physics.world.DestroyBody(physics.ball); physics.ball = null; }

		},
		'createJoint': function createJoint () {
			if (physics.track_joint) { physics.destroyJoint(); }
			physics.track_joint_def.bodyA = physics.world.GetGroundBody();
			physics.track_joint_def.bodyB = physics.head_tracker;
			physics.track_joint_def.target = physics.head_tracker.GetWorldCenter();
			physics.track_joint_def.maxForce = 40000.0 * physics.head_tracker.GetMass();
			physics.track_joint = physics.world.CreateJoint(physics.track_joint_def);
		},
		'destroyJoint': function destroyJoint () {
			if (physics.track_joint) {
				physics.world.DestroyJoint(physics.track_joint);
				physics.track_joint = null;
			}
		}
	},
	Vector = Box2D.Common.Math.b2Vec2,
	nullVector = new Vector(0, 0),

	tick = function tick (timestamp) {

		var ball_vel,
			ball_pos,
			factor,
			should_replace = false;

		if (game.state.get() === game.state.PLAYING) {

			if (physics.ball) {
				ball_pos = physics.ball.GetWorldCenter();
				ball_vel = physics.ball.GetLinearVelocity();

				if ((ball_pos.y < -physics.unit_width) && (ball_vel.y < 0)) {
					ball_vel = new Vector(ball_vel.x, 0);
					should_replace = true;
				}

				if (should_replace) { physics.ball.SetLinearVelocity(ball_vel); }
				physics.ball.ApplyForce(physics.gravity_vector, physics.ball.GetWorldCenter());

				if (physics.ball_overlay) {
					physics.ball_overlay.setPosition(
						(ball_pos.x / physics.area_width) - 0.5,
						(ball_pos.y / physics.area_height) - 0.5
					);
				}

				// Ball falls out of scope
				if (ball_pos.y > physics.area_height * 1.25) {
					//ball_pos = new Vector(physics.area_width / 2, physics.area_height / 3);
					//physics.ball.SetPosition(ball_pos);
					game.state.set(game.state.LOST);
				}
			}

			physics.world.Step(1 / 30, 5, 5);
			physics.world.DrawDebugData();
			physics.world.ClearForces();
			if ((typeof timestamp !== 'boolean') || !timestamp) { window.requestAnimationFrame(tick); }

		}

	},
	initialize = function initialize () {

		/* GAME LOGIC
		 * ******************************************
		 * Bind various events coming from Hangouts API for stuff
		 * like keeping track of the game state and scores via shared state,
		 * as well as of enabled participants, to know who drops out if drop-outs
		 * do happen during the game.
		 */
		gapi.hangout.data.onStateChanged.add(function handleSharedState (ev) {

			console.log('sharedStateChange');

			var currentGameState = game.state.get(),
				newGameState = parseInt(ev.state.gameState, 10),
				lastScore = parseInt(ev.state.lastScore, 10),
				temp;

			console.log('Last scores: ', game.lastScore, lastScore);

			// Save last state for easier access
			lastSharedState = ev.state;

			// Update game state if it changes
			// (take local states into consideration)
			if (!(
				(currentGameState === game.state.LOST || currentGameState === game.state.LATEJOIN) &&
				(newGameState === game.state.PLAYING)
			)) {
				currentGameState = newGameState;
				game.state.set(newGameState);
			}

			// Update game scores
			console.log('test: ', currentGameState, (lastScore > game.lastScore));
			if ((currentGameState === game.state.PLAYING) && (lastScore > game.lastScore)) {
				game.lastScore = lastScore;
				temp = {};
				_.each(ev.state, function (value, key) {
					if (key.substr(0, 6) === 'score|') {
						temp[key.substr(6)] = parseInt(value, 10);
					}
				});
				bean.fire(game, 'onPointScored', temp);
			}

		});
		gapi.hangout.onEnabledParticipantsChanged.add(function checkPresentPlayers (ev) {

			if (game.state.get() === game.state.PLAYING) {
				// Check for list of players that started the game, but are not present anymore
				var presentPlayers = _.pluck(ev.enabledParticipants, 'id'),
					droppedPlayers = _.filter(_.keys(game.scores.get()), function (item) { return !_.contains(presentPlayers, item); });
				if (droppedPlayers.length) { bean.fire(game, 'onPlayerDrop', droppedPlayers); }
			}

		});

		// BIND GAME EVENTS
		bean.on(game, 'onGameStart', function onGameStart () {

			console.log('onGameStart');

			physics.createTracker();
			physics.createBall();

			window.setTimeout(tick, 2500);

		});
		bean.on(game, 'onGameLost', function onGameLost () {

			console.log('onGameLost');

			physics.destroyTracker();
			physics.destroyBall();

			var delta = {}, removal = [], newPlayerCount = parseInt(lastSharedState.playerCount, 10) - 1;
			if (newPlayerCount <= 0) {
				delta.gameState = '' + game.state.ENDED;
				removal = _.chain(lastSharedState)
					.keys()
					.filter(function (item) { return item.substr(0, 6) === 'score|'; })
					.value();
				removal.push('lastScore');
				removal.push('playerCount');
			} else {
				delta.playerCount = '' + newPlayerCount;
			}

			gapi.hangout.data.submitDelta(delta, removal);

		});
		bean.on(game, 'onGameEnd', function () {

			console.log('onGameEnd');

		});
		bean.on(game, 'onLateJoin', function () {

			alert('onLateJoin');

		});
		bean.on(game, 'onPointScored', function onPointScored (points) {

			console.log('onPointScored');

			// Update point storage
			game.scores.set(points);
			var newScores = game.scores.get();

			// Update DOM to reflect new points
			document.getElementById('local').innerHTML = newScores[gapi.hangout.getLocalParticipantId()];
			document.getElementById('team').innerHTML = _.reduce(newScores, function (a, b) { return a + b; });

		});

		bean.on(game, 'onPlayerDrop', function onPlayerDrop (droppedPlayers) {

			// Remove missing players' scoring
			_.each(droppedPlayers, game.scores.remove);

			// Refresh the score
			bean.fire(game, 'onPointScored', {});

			// Remove missing players from shared state
			gapi.hangout.data.submitDelta({}, _.map(droppedPlayers, function (item) { return 'score|' + item; }));

		});

		/* GAME PHYSICS
		 * ******************************************
		 * Initialize various aspects of Box2D physics engine to have it working
		 * on bouncing the ball. Load required resources and so on.
		 */

		var video = gapi.hangout.layout.getVideoCanvas(),
			scaling_keys = _.map(_.keys(physics.scaling_map), parseFloat),
			body_def = new Box2D.Dynamics.b2BodyDef(),
			fixture_def = new Box2D.Dynamics.b2FixtureDef(),
			contact = new Box2D.Dynamics.b2ContactListener(),
			sharedState;

		physics.area_width = video.getWidth(),
		physics.area_height = video.getHeight();
		if (document.getElementById('physics_test')) {
			document.getElementById('physics_test').width = physics.area_width;
			document.getElementById('physics_test').height = physics.area_height;
		}

		// Set up world with null gravity
		physics.world = new Box2D.Dynamics.b2World(nullVector, false);

		// Establish side walls to prevent the ball from falling off sides
		body_def.type = Box2D.Dynamics.b2Body.b2_staticBody;
		fixture_def.friction = 0.5;
		fixture_def.restitution = 1;
		fixture_def.shape = new Box2D.Collision.Shapes.b2PolygonShape();
		fixture_def.shape.SetAsBox(2, physics.area_height * 10);

		body_def.position.Set(-1, 0);
		physics.world.CreateBody(body_def).CreateFixture(fixture_def);
		body_def.position.Set(physics.area_width + 1, 0);
		physics.world.CreateBody(body_def).CreateFixture(fixture_def);

		// Set up contact listener
		contact.BeginContact = function (contact) {
			var bodyA = contact.GetFixtureA().GetBody(),
				bodyB = contact.GetFixtureB().GetBody(),
				delta, id;

			if (
				((bodyA === physics.head_tracker) && (bodyB === physics.ball)) ||
				((bodyA === physics.ball) && (bodyB === physics.head_tracker))
			) {

				bodyA = physics.head_tracker;
				bodyB = physics.ball;

				// Only count downward-moving ball
				if (bodyB.GetLinearVelocity().y > 0) {

					delta = {}; id = gapi.hangout.getLocalParticipantId();
					delta['score|' + id] = '' + (game.scores.get()[id] + 1);
					delta.lastScore = '' + (new Date()).getTime();

					gapi.hangout.data.submitDelta(delta, []);

				}

			}
		};

		physics.world.SetContactListener(contact);

		// Set up mouse joint definition
		physics.track_joint_def = new Box2D.Dynamics.Joints.b2MouseJointDef();

		if (document.getElementById('physics_test')) {
			// Set up debug tracking of the world
			var debugDraw = new Box2D.Dynamics.b2DebugDraw();
			debugDraw.SetSprite(document.getElementById("physics_test").getContext("2d"));
			debugDraw.SetDrawScale(1.0);
			debugDraw.SetFillAlpha(0.5);
			debugDraw.SetLineThickness(1.0);
			debugDraw.SetFlags(Box2D.Dynamics.b2DebugDraw.e_shapeBit | Box2D.Dynamics.b2DebugDraw.e_jointBit);
			physics.world.SetDebugDraw(debugDraw);
		}

		// Set up handling of incoming face tracking data;
		// specifically, the update of tracker position and rescaling
		gapi.hangout.av.effects.onFaceTrackingDataChanged.add(function faceDataChange (faceData) {
			var i, scale,
				biggest_scale = -1,
				currentGameState = game.state.get();

			if (faceData.hasFace) {

				// Calculate the scale (and adjust object accordingly if scale is different from previous frame)
				scale = Math.abs(faceData.leftEye.x - faceData.rightEye.x);
				for (i = 0; i < scaling_keys.length; i += 1) {
					if (scaling_keys[i] <= scale && scaling_keys[i] > biggest_scale) {
						biggest_scale = scaling_keys[i];
					}
				}
				if (biggest_scale === -1) { biggest_scale = scaling_keys[0]; }

				// Determine what scales to applya
				if (physics.scaling_map[biggest_scale] !== physics.last_scale) {

					physics.last_scale = physics.scaling_map[biggest_scale];
					physics.unit_width = physics.area_width / physics.last_scale;
					physics.unit_height = physics.area_height / physics.last_scale;

					if (currentGameState === game.state.PLAYING) {
						physics.createTracker();
						physics.createBall();
					}

				}

				if (currentGameState === game.state.PLAYING) {

					// Track face position
					if (!physics.track_joint) { physics.createJoint(); }
					physics.track_joint.SetTarget(new Vector(
						(faceData.noseRoot.x + 0.5) * physics.area_width,
						(faceData.noseRoot.y - Math.abs(faceData.leftEye.x - faceData.rightEye.x) + 0.5) * physics.area_height
					));

				}

			} else {

				if (currentGameState === game.state.PLAYING) {

					// Disable face tracking if data not present
					if (physics.track_joint) { physics.destroyJoint(); }

				}

			}
		});

		// Load image resource for the ball
		physics.ball_overlay_res = gapi.hangout.av.effects.createImageResource(
			'http://dev.welikepie.com/football-hangout-app/images/football.png'
		);

		// Set to late join state if appropriate
		sharedState = gapi.hangout.data.getState();
		if (
			('gameState' in sharedState) &&
			(parseInt(sharedState.gameState, 10) === game.state.PLAYING)
		) { game.state.set(game.state.LATEJOIN); }

		bean.on(document.getElementsByTagName('button')[0], 'click', function () {

			var participants = gapi.hangout.getEnabledParticipants(),
				removal = [],
				delta = {
					'gameState': '' + game.state.PLAYING,
					'playerCount': '' + participants.length,
					'lastScore': '' + (new Date()).getTime()
				};

			_.each(participants, function (player) { delta['score|' + player.id] = '0'; });
			removal = _.chain(lastSharedState)
				.keys()
				.filter(function (item) { return item.substr(0, 6) === 'score|' && !_.has(delta, item); })
				.value();

			console.log('Start: ', delta, removal);
			gapi.hangout.data.submitDelta(delta, removal);

		});

	};

	gapi.hangout.onApiReady.add(initialize);

};