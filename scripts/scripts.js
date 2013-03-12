/*jshint newcap:false, bitwise:false, devel:true, unused:false */
/*global $:true, _:true, Box2D:true, gapi:true, _gaq:true */
window.init = function () {
	"use strict";

	window.requestAnimationFrame = (function (undefined) {
		return window.requestAnimationFrame ||
			window.webkitRequestAnimationFrame ||
			window.mozRequestAnimationFrame ||
			function (callback) { window.setTimeout(function () { callback((new Date()).getTime()); }, 1000 / 60); };
	})();

	// Box2D PAckages
	var b2Vec2 = Box2D.Common.Math.b2Vec2,
		b2AABB = Box2D.Collision.b2AABB,
		b2BodyDef = Box2D.Dynamics.b2BodyDef,
		b2Body = Box2D.Dynamics.b2Body,
		b2FixtureDef = Box2D.Dynamics.b2FixtureDef,
		b2Fixture = Box2D.Dynamics.b2Fixture,
		b2World = Box2D.Dynamics.b2World,
		b2MassData = Box2D.Collision.Shapes.b2MassData,
		b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape,
		b2CircleShape = Box2D.Collision.Shapes.b2CircleShape,
		b2DebugDraw = Box2D.Dynamics.b2DebugDraw,
		b2MouseJointDef =  Box2D.Dynamics.Joints.b2MouseJointDef,

		area_width,
		area_height,
		display_scale,

		world,
		head_body,
		ball_body,
		joint_def = new b2MouseJointDef(),
		track_joint,

		init = function init () {

			// Create world for physics simulation
			var fixture_def = new b2FixtureDef(),
				body_def = new b2BodyDef();

			world = new b2World(
				new b2Vec2(0, 10),
				true
			);

			// Assign default physics parameters to fixture
			fixture_def.density = 1;
			fixture_def.friction = 0.5;
			fixture_def.restitution = 0.5;

			// WORLD INIT

			// Create collision borders (prevent ball from falling off the screen)
			body_def.type = b2Body.b2_staticBody;
			body_def.linearDamping = 0;
			fixture_def.shape = new b2PolygonShape();

			// Vertical boxes (sides)
			fixture_def.shape.SetAsBox(2, area_height);
			body_def.position.Set(-1, area_height / 2);
			world.CreateBody(body_def).CreateFixture(fixture_def);
			body_def.position.Set(area_width + 1, area_height / 2);
			world.CreateBody(body_def).CreateFixture(fixture_def);

			// Horizontal boxes (up & down)
			fixture_def.shape.SetAsBox(area_width, 2);
			body_def.position.Set(area_width / 2, -1);
			world.CreateBody(body_def).CreateFixture(fixture_def);
			body_def.position.Set(area_width / 2, area_height + 1);
			world.CreateBody(body_def).CreateFixture(fixture_def);

			// OBJECT INIT

			// Create two circle-shaped objects, one for ball and one for head
			fixture_def.shape = new b2CircleShape();

			// Head
			body_def.type = b2Body.b2_kinematicBody;
			body_def.bullet = true;
			fixture_def.density = 999;
			fixture_def.shape.SetRadius(8);
			body_def.position.Set(area_width / 2, area_height * 2 / 3);
			head_body = world.CreateBody(body_def);
			head_body.CreateFixture(fixture_def);

			// Ball
			body_def.type = b2Body.b2_dynamicBody;
			body_def.allowSleep = false;
			body_def.inertiaScale = 1;
			fixture_def.density = 1;
			fixture_def.shape.SetRadius(5);
			body_def.position.Set(area_width / 2, area_height / 3);
			ball_body = world.CreateBody(body_def);
			ball_body.CreateFixture(fixture_def);

			// DEBUG DRAW
			var debugDraw = new b2DebugDraw();
			debugDraw.SetSprite(document.getElementById("physics_test").getContext("2d"));
			debugDraw.SetDrawScale(display_scale);
			debugDraw.SetFillAlpha(0.5);
			debugDraw.SetLineThickness(1.0);
			debugDraw.SetFlags(b2DebugDraw.e_shapeBit | b2DebugDraw.e_jointBit);
			world.SetDebugDraw(debugDraw);

		},

		tick = function tick () {

			world.Step(1 / 30, 5, 5);
			world.DrawDebugData();
			world.ClearForces();

			window.requestAnimationFrame(tick);

		};

	gapi.hangout.onApiReady.add(function () {

		var video = gapi.hangout.layout.getVideoCanvas(),
			width = video.getWidth(),
			height = video.getHeight();

		try {

			document.getElementById('physics_test').width = width;
			document.getElementById('physics_test').height = height;

			area_width = 60;
			area_height = height * (60 / width);
			display_scale = width / 60;

			init();
			window.requestAnimationFrame(tick);

			gapi.hangout.av.effects.onFaceTrackingDataChanged.add(function changeFaceData (faceData) {
				if (faceData.hasFace) {
					if (track_joint) {
						track_joint.SetTarget(new b2Vec2(
							(faceData.noseRoot.x + 0.5) * area_width,
							(faceData.noseRoot.y + 0.5) * area_height
						));
					} else {
						// Establish tracking joint for moving the face
						joint_def.bodyA = world.GetGroundBody();
						joint_def.bodyB = head_body;
						joint_def.target = head_body.GetWorldCenter();
						joint_def.maxForce = 1000.0 * head_body.GetMass();
						track_joint = world.CreateJoint(joint_def);
						track_joint.SetTarget(new b2Vec2(
							(faceData.noseRoot.x + 0.5) * area_width,
							(faceData.noseRoot.y + 0.5) * area_height
						));
					}
				} else {
					if (track_joint) {
						world.DestroyJoint(track_joint);
						track_joint = null;
					}
				}
			});

		} catch (e) {
			console.error(e);
			throw e;
		}

	});

};