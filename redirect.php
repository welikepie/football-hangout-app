<?php

	$is_snippet = preg_match("/https:\/\/developers\.google\.com\/\+\/web\/snippet\//", $_SERVER['HTTP_USER_AGENT']);

	if ($is_snippet) {
		header('HTTP/1.1 200 OK', true, 200);
		header('Content-Type: text/html; charset=utf-8');
	} else {
		header('HTTP/1.1 303 See Other', true, 303);
		header('Location: <%= pkg.app.hangoutUrl %>');
		exit();
	}

?><!DOCTYPE html>
<html itemscope itemtype="http://schema.org/WebApplication">
	<head>
		<title itemprop="name"><%= pkg.app.title %></title>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<link rel="canonical" itemprop="url" href="<%= pkg.app.appUrl %>">
	</head>
	<body>
		<img itemprop="image" src="<%= pkg.app.appUrl %>images/logo_big.png" width="126" height="136">
		<p itemprop="description">Jouer sur Google Hangout et voir qui peut garder la balle plus longtemps!</p>
		<a href="<%= pkg.app.hangoutUrl %>">App!</a>
	</body>
</html>